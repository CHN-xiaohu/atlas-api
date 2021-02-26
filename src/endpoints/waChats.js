import {endpoint, protect, unsafe} from "../lib/api-helper";
import {mongo} from "../lib/db";
import {endpoints} from "../lib/endpoints";
import {whatsapp} from "../lib/whatsapp-api";
import {set, get} from "../lib/socket-storage";
import {buildQuery, escapedRegExp, forEachP} from "../helper";
import {assoc} from "ramda";
import dayjs from "dayjs";

set("whatsapp-statuses", {}, true);
set("whatsapp-sync-info", {syncing: false}, true);

const db = mongo.get("waChats");

const defaults = {
    skip: 0,
    limit: 0,
    sort: {
        last_message_time: -1,
    },
    projection: {},
};

const limitation = {
    deleted_at: {$eq: null},
};

const dayjsInstance2Time = dayjsInstance => Math.floor(dayjsInstance.toDate().getTime() / 1000);

const syncMessagesToDatabase = async (instance, startTime, endTime, count = 200, page = 0) => {
    const result = await whatsapp.request(instance, "/messagesHistory", {page, count});
    const {messages} = result;

    if (messages.length <= 0) return;

    // eslint-disable-next-line immutable/no-let
    for (let message of messages) {
        if (message.time > endTime) continue;
        if (message.time < startTime) return;
        const messageOnDb = await db.findOne({message_id: message.id});
        if (messageOnDb == null) await endpoints.waMessages.newMessageWithoutNotify(message, instance);
    }

    return syncMessagesToDatabase(instance, startTime, endTime, count, page + 1);
};

export const waChats = endpoint(
    {
        reboot: protect(
            user => user?.access?.whatsapp?.canRestart, //canRestart
            async ({instance = whatsapp.instance}) => whatsapp.post(instance, "/reboot"),
            ["waChats"],
        ),

        logout: protect(
            user => user?.access?.whatsapp?.canLogout, //canLogout
            async ({instance = whatsapp.instance}) => whatsapp.post(instance, "/logout"),
            ["waChats"],
        ),

        readChat: protect(
            user => user?.access?.whatsapp?.canMarkAsRead, //canMarkAsRead
            async ({chatId, instance_number}, {login}) => {
                endpoints.logs.add({
                    chatId,
                    instance_number,
                    type: "waChat",
                    event: "markAsViewed",
                    author: login,
                });
                const chat = await db.findOne({chatId, instance_number, ...limitation});
                if (chat == null) return null;
                return whatsapp.post(chat.instance_number, "/readChat", {}, {chatId});
            },
            ["waChats"],
        ),

        get: protect(
            user => user?.access?.whatsapp?.canSeeChats, //canSeeChats
            async ({instance, search, page = 1, limit = 50, ...params}) => {
                const searchRegex = escapedRegExp(search, "i");
                const searchByChat = search?.replace(/\D/g, "");
                const searchByChatRegex = escapedRegExp(searchByChat, "i");
                const query = buildQuery([
                    {
                        condition: typeof search === "string" && search.length > 0,
                        query: {
                            $or: [{name: {$regex: searchRegex}}, {chatId: {$regex: searchRegex}}],
                        },
                    },
                    {
                        condition: instance != null,
                        query: {
                            $or: [{instances: {$in: [instance]}}, {instance_number: instance}],
                        },
                    },
                    {
                        condition: searchByChat !== "" && !isNaN(+searchByChat),
                        query: {
                            $or: [{name: {$regex: searchByChatRegex}}, {chatId: {$regex: searchByChatRegex}}]
                        }
                    },
                    {
                        query: {
                            last_message_time: {$ne: null},
                        },
                    },
                ]);
                const currentPage = parseInt(page);
                const options = {
                    ...params,
                    skip: (currentPage - 1) * limit,
                    limit,
                };

                const chats = await db.find({...query, ...limitation}, options);
                const nextPage =
                    (await db.count({...query, ...limitation}, {...options, skip: options.skip + limit, limit: 1})) > 0
                        ? currentPage + 1
                        : null;
                return {
                    data: chats,
                    nextPage,
                };
            },
        ),
        byId: protect(
            user => user?.access?.whatsapp?.canSeeChats,
            async ({_id, ...params}) => {
                return db.findOne({_id, last_message_time: {$ne: null}, ...limitation}, {...defaults, ...params});
            },
        ),
        byNumber: protect(
            user => user?.access?.whatsapp?.canSeeChats, //canSeeChats
            async ({number, ...params}) => {
                const numbers = [].concat(number);
                const chatIds = numbers.map(number => `${number}@c.us`);
                const participants = numbers.map(number => `${number}@c.us`);

                //console.log(number, await db.find({chatId: `${number}@c.us`}));
                return db.find(
                    {
                        last_message_time: {$ne: null},
                        $or: [
                            {chatId: {$in: chatIds}},
                            {
                                "metadata.isGroup": true,
                                "metadata.participants": {$in: participants},
                            },
                        ],
                        ...limitation,
                    },
                    {...defaults, ...params},
                );
            },
        ),

        action: protect(
            user => user?.access?.whatsapp?.canOperateChats,
            async ({instance, action}) => {
                const {act} = get("whatsapp-statuses")?.[instance]?.statusData?.actions?.[action];
                if (act == null) return null;
                const result = await whatsapp.post(instance, `/${act}`);
                return result;
            },
        ),

        qrcode: protect(
            user => user?.access?.whatsapp?.canLogin,
            async ({instance}) => {
                const data = await whatsapp.binaryRequest(instance, "/qr_code");
                return "data:image/png;base64," + Buffer.from(data).toString("base64");
            },
        ),

        syncChatRecords: protect(
            user => user?.access?.whatsapp?.canSyncMessages,
            async ({instances, startDate, endDate}) => {
                const syncInfo = get("whatsapp-sync-info");
                if (syncInfo.syncing) return;
                set("whatsapp-sync-info", assoc("syncing", true, syncInfo));
                (async () => {
                    await forEachP(async instance => {
                        const startTime = dayjsInstance2Time(dayjs(startDate).startOf("day"));
                        const endTime = dayjsInstance2Time(dayjs(endDate).endOf("day"));
                        await syncMessagesToDatabase(instance, startTime, endTime);
                    }, instances);
                    set("whatsapp-sync-info", assoc("syncing", false, syncInfo));
                })();
            },
        ),
    },
    {
        db,
        limitation,

        status: unsafe(
            async ({instance = whatsapp.instance}) => {
                const response = await whatsapp.request(instance, "/status");
                return response.accountStatus;
            },
            ["waChats"],
        ),

        retrieveQRCode: unsafe(async ({instance = whatsapp.instance}) => whatsapp.request(instance, "/qr_code"), [
            "waChats",
        ]),

        chatUpdated: unsafe(
            async (data, instance_number) => {
                const newData = data.new;
                if (newData == null) return;

                const {id: chatId, name, metadata, image} = newData;

                if (metadata?.isGroup) {
                    const existing = await db.findOne({chatId, instances: instance_number, ...limitation});

                    if (existing == null) {
                        await db.update(
                            {chatId, ...limitation},
                            {$push: {instances: instance_number}, $set: {name, metadata, image}},
                            {upsert: true},
                        );
                    } else {
                        await db.update(
                            {chatId, instances: instance_number, ...limitation},
                            {$set: {name, metadata, image}},
                        );
                    }
                } else {
                    await db.update(
                        {chatId, instance_number, ...limitation},
                        {
                            $set: {
                                chatId,
                                name,
                                metadata,
                                image,
                                instance_number,
                            },
                        },
                        {upsert: true},
                    );
                }
            },
            ["waChats"],
        ),

        syncStatus: async instance => {
            const {qrCode, ...status} = await whatsapp.request(instance, "/status", {
                full: true,
                no_wakeup: true,
            });
            const statuses = get("whatsapp-statuses");
            set("whatsapp-statuses", {
                ...statuses,
                [instance]: status,
            });
        },

        syncStatuses: async () => {
            const statuses = (
                await Promise.all(
                    Object.keys(whatsapp.information).map(async instance => {
                        const response = await whatsapp.request(instance, "/status", {
                            full: true,
                            no_wakeup: true,
                        });
                        if (response == null) return null;
                        const {qrCode, ...status} = response;
                        return {instance, status};
                    }),
                )
            )
                .filter(item => item != null)
                .reduce((acc, {instance, status}) => {
                    acc[instance] = status;
                    return acc;
                }, {});

            set("whatsapp-statuses", statuses);
        },
    },
);

waChats.syncStatuses();
