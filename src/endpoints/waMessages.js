import {endpoint, protect, unsafe} from "../lib/api-helper";
import {id as monkid, mongo} from "../lib/db";
import {endpoints} from "../lib/endpoints";

import {getTaskCompleteTime, retry} from "../helper";
import {whatsapp} from "../lib/whatsapp-api";

// const autoresponseMessage = {
//     ru: "Спасибо, что выбрали компанию Глобус! К сожалению, вы не застали нас в офисе.\n" +
//         "Наше рабочее время: Понедельник - Пятница, 10:00 - 19:00 (По Китайскому времени).\n" +
//         "Наш менеджер ответит Вам в самое ближайшее время.",
//     en: "Thanks for reaching out to Globus!\n" +
//         "We are not in the office at the moment. Our working hours: Monday to Friday, 10:00-19:00 (China time).\n" +
//         "Our manager will reply to you ASAP."
// };

const transformToOldMessageStruct = newMessage => {
    const {id: message_id, body, fromMe, author, time, chatId, caption, messageNumber, type, senderName} = newMessage;
    return {
        message_id,
        body,
        fromMe,
        author,
        time,
        chatId,
        messageNumber,
        caption,
        type,
        senderName,
    };
};

const getOnlineMessageByMessage = async message => {
    const response = await whatsapp.request(message.instance_number, "/messages", {
        lastMessageNumber: message.messageNumber - 1,
        chatId: message.chatId,
        limit: 1,
    });
    if (response?.messages?.[0]?.messageNumber !== message.messageNumber) {
        log("data is null");
        return null;
    }
    return response?.messages?.[0] == null
        ? null
        : {
              ...response?.messages?.[0],
              instance_number: message.instance_number,
          };
};

const getOnlineMessageById = async _id => {
    const message = await db.findOne({_id});
    return message == null ? null : getOnlineMessageByMessage(message);
};

const log = (...args) => console.log("[whatsapp]", ...args);

const defaults = {
    skip: 0,
    limit: 0,
    sort: {
        sort: 1,
        time: 1,
    },
    projection: {},
};

const db = mongo.get("waMessages");
const waChatsDb = mongo.get("waChats");

export const waMessages = endpoint(
    {
        syncMessages: protect(
            user => user?.access?.whatsapp?.canSyncMessages,
            async ({chatId}, {login}) => {
                const chat = await endpoints.waChats.db.findOne({chatId});
                const response = await whatsapp.request(chat.instance_number, `/messagesHistory`, {
                    count: 10000,
                    chatId,
                });
                endpoints.logs.add({
                    chatId,
                    type: "waChat",
                    event: "sync",
                    author: login,
                });

                const messages = await Promise.all(
                    response.messages.map(message => {
                        const {id: message_id} = message;
                        return db.findOneAndUpdate(
                            {message_id},
                            {
                                $set: {
                                    ...transformToOldMessageStruct(message),
                                    instance_number: chat.instance_number,
                                },
                            },
                            {upsert: true},
                        );
                    }),
                );

                log("synced", messages.length, "messages");
            },
            ["waMessages"],
        ),

        lastMessages: protect(
            user => user?.access?.whatsapp?.canSeeMessages,
            async ({chats}) => {
                if (!Array.isArray(chats) || chats.length === 0) {
                    return [];
                }
                return await Promise.all(
                    chats.map(({chatId, instance}) =>
                        db.findOne({chatId, instance_number: instance}, {sort: {time: -1}, limit: 1}),
                    ),
                );
            },
        ),

        sendMessage: protect(
            user => user?.access?.whatsapp?.canSendMessages,
            async ({body, chatId, instance = whatsapp.instance}, {login}) => {
                log("send message to", chatId, body);
                endpoints.logs.add({
                    chatId,
                    type: "waMessage",
                    event: "send",
                    body,
                    author: login,
                });
                await whatsapp.post(
                    instance,
                    "/sendMessage",
                    {},
                    {
                        body,
                        chatId,
                    },
                );
            },
            ["waMessages"],
        ),

        getMessage: protect(
            user => user?.access?.whatsapp?.canSeeMessages,
            async ({_id, instance_number}) => {
                const message = await getOnlineMessageById(_id);
                return message.instance_number === instance_number ? message : null;
            },
        ),

        sendFile: protect(
            user => user?.access?.whatsapp?.canSendMessages,
            async ({chatId, body, filename, instance = whatsapp.instance}, {login}) => {
                log("send file to", chatId, filename);
                endpoints.logs.add({
                    chatId,
                    type: "waMessage",
                    event: "sendFile",
                    filename,
                    author: login,
                });

                whatsapp.post(
                    instance,
                    "/sendFile",
                    {},
                    {
                        chatId,
                        body,
                        filename,
                    },
                );
            },
        ),

        syncMessage: protect(
            user => user?.access?.whatsapp?.canSyncMessages,
            async ({_id}, {login}) => {
                endpoints.logs.add({
                    type: "waMessage",
                    event: "sync",
                    message: _id,
                    author: login,
                });
                const message = await getOnlineMessageById(_id);

                return message == null
                    ? null
                    : db.findOneAndUpdate({_id}, {$set: transformToOldMessageStruct(message)});
            },
            ["waMessages"],
        ),

        byChat: protect(
            user => user?.access?.whatsapp?.canSeeMessages,
            async ({chatId, instance, page = 1, limit = 100, ...params}) => {
                const currentPage = parseInt(page);
                const options = {
                    ...defaults,
                    ...params,
                    skip: (currentPage - 1) * limit,
                    limit,
                    sort: {
                        time: -1,
                    },
                };
                const messages = await db.find({chatId, instance_number: instance}, options);
                const nextPage =
                    (await db.count(
                        {chatId, instance_number: instance},
                        {...options, skip: options.skip + limit, limit: 1},
                    )) > 0
                        ? currentPage + 1
                        : null;
                return {data: messages, nextPage};
            },
        ),
    },
    {
        db,
        newMessageWithoutNotify: async (data, instance_number) => {
            const {id: message_id, chatId, messageNumber} = data;
            const message = await db.findOneAndUpdate(
                {message_id},
                {
                    $set: {
                        ...transformToOldMessageStruct(data),
                        instance_number,
                        status_sent: true,
                        status_sent_time: data.time,
                    },
                },
                {upsert: true},
            );

            const lastMessageData = {
                last_message_number: messageNumber,
                last_message_number_id: monkid(message._id),
                last_message_time: message.time,
            };

            const getLastMessageData = isGroup =>
                isGroup ? {last_updated_instance: instance_number, ...lastMessageData} : lastMessageData;

            const isNewMessage = (chat, message) =>
                chat?.last_message_time == null || chat.last_message_time <= message.time;

            const getExtra = (chat, message, isGroup) =>
                isNewMessage(chat, message) ? getLastMessageData(isGroup) : {};

            const isEmptyExtra = extra => !(Object.keys(extra).length > 0);

            const existingChat = await waChatsDb.findOne({chatId, ...endpoints.waChats.limitation});

            const isItAGroup = async (instance_number, chatId) => {
                const result = await retry({
                    callback: () => {
                        return whatsapp.request(instance_number, "/dialog", {chatId})
                    }
                });

                return result == null
                ? null
                : result.metadata?.isGroup;
            };

            const isGroup = existingChat != null
                ? existingChat.metadata?.isGroup
                : await isItAGroup(instance_number, chatId);

            if (isGroup == null) {
                console.error("isGroup == null");
                return;
            }

            if (isGroup) {
                const chat = await waChatsDb.findOne({
                    chatId,
                    instances: instance_number,
                    ...endpoints.waChats.limitation,
                });

                if (chat == null) {
                    const onlineChat = await whatsapp.request(instance_number, "/dialog", {chatId});
                    const {name, metadata, image} = onlineChat;

                    const extra = getExtra(chat, message, true);

                    await waChatsDb.update(
                        {chatId, ...endpoints.waChats.limitation},
                        {$push: {instances: instance_number}, $set: {name, metadata, image, ...extra}},
                        {upsert: true},
                    );
                } else {
                    const extra = getExtra(chat, message, true);
                    !isEmptyExtra(extra) &&
                        (await waChatsDb.update(
                            {chatId, instances: instance_number, ...endpoints.waChats.limitation},
                            {$set: extra},
                        ));
                }
            } else {
                const chat = await waChatsDb.findOne({chatId, instance_number, ...endpoints.waChats.limitation});

                if (chat == null) {
                    const onlineChat = await whatsapp.request(instance_number, "/dialog", {chatId});
                    const extra = getExtra(chat, message, false);

                    waChatsDb.insert({
                        chatId,
                        image: onlineChat.image,
                        instance_number,
                        metadata: onlineChat.metadata,
                        name: onlineChat.name,
                        ...extra,
                    });
                } else {
                    const extra = getExtra(chat, message, false);
                    !isEmptyExtra(extra) &&
                        (await waChatsDb.update(
                            {chatId, instance_number, ...endpoints.waChats.limitation},
                            {$set: extra},
                        ));
                }
            }

            try {
                endpoints.waMessages.onNewMessageWithoutNotify(data);
            } catch (e) {
                log(e);
            }
        },

        newMessage: unsafe(
            async (data, instance_number) => {
                return endpoints.waMessages.newMessageWithoutNotify(data, instance_number);
            },
            ["waMessages"],
        ),
        messageUpdated: unsafe(
            async data => {
                const {id: message_id, status} = data;

                const statusData =
                    status === "delivered"
                        ? {
                              status_delivered: true,
                              status_delivered_time: Math.floor(new Date().getTime() / 1000),
                          }
                        : status === "viewed"
                        ? {
                              status_viewed: true,
                              status_viewed_time: Math.floor(new Date().getTime() / 1000),
                          }
                        : status === "sent"
                        ? {
                              status_sent: true,
                              status_sent_time: Math.floor(new Date().getTime() / 1000),
                          }
                        : null;

                if (statusData != null) {
                    db.update({message_id}, {$set: statusData});
                }
            },
            ["waMessages"],
        ),

        onNewMessageWithoutNotify: async ({type, chatId}) => {
            const number = +chatId.match(/\d+/)[0];
            const lead = (await endpoints.leads.byPhoneNumbers({numbers: [number]}))[0];
            if (type === "call_log") {
                //create task
                if (lead != null) {
                    const {id} = lead;
                    endpoints.tasks.add({
                        completeTill: getTaskCompleteTime(),
                        text: "Написать в карточке о чем был разговор",
                        lead: id,
                    });
                } else {
                    log("there was a phone call but lead not found", number);
                }
            }

            //autoresponse
            // if (!isWorkingTime(dayjs(), 8, 22) && type === "chat" && fromMe === false) {
            //     //const language = (await db.findOne({body: {$regex: /[\u0400-\u04FF]+/} , type: 'chat'}) == null) ? 'en' : 'ru';
            //     const language = `${body}`.match(/[\u0400-\u04FF]+/) == null ? "en" : "ru";

            //     const checker =
            //         language === "en" ? "Thanks for reaching out to Globus" : "Спасибо, что выбрали компанию Глобус";
            //     const today = dayjs().startOf("day").unix();
            //     //fine message
            //     const message = await db.findOne({body: {$regex: checker}, time: {$gt: today}, chatId});
            //     if (message == null) {
            //         //send autoresponse
            //         log("Sending autoresponse [temporary disabled]", chatId, body, language);
            //         //this.sendMessage({body: autoresponseMessage[language], chatId, instance: instance_number});
            //     } else {
            //         log("Duplicate", chatId, body, language);
            //     }
            // }
        },

        onNewMessage: unsafe(
            async data => {
                return endpoints.waMessages.onNewMessageWithoutNotify(data);
            },
            ["waMessages"],
        ),
    },
);
