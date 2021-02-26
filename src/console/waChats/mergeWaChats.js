import {mongo} from "../../lib/db";
import {print} from "../helper";
import {composeP, forEachP, mostWantedItemOfArrayBy} from "../../helper"
import {assoc, reduce} from "ramda";

const db = mongo.get("waChats");

(async () => {
    const chats = await db.find({"metadata.isGroup": true, deleted_at: {$eq: null}});

    print(`有 ${chats.length} 个 waChats 需要处理`);


    const mergeChats = forEachP(async (chats) => {
        const mainChat = mostWantedItemOfArrayBy((a, b) => {
            return a.last_message_time >= b.last_message_time ? a : b;
        }, chats);

        const deletedChats = chats.filter(chat => chat._id.toString() !== mainChat._id.toString());

        await forEachP(async chat => {
            await db.update({_id: chat._id}, {$set: {deleted_at: 0}});
        }, deletedChats);

        const deletedInstances = deletedChats.map(chat => chat.instance_number);
        const instances = [...new Set(deletedInstances.concat(mainChat.instance_number))];

        await db.update(
            {_id: mainChat._id},
            {$set: {
                instances,
                last_updated_instance: mainChat.instance_number
            }}
        );
    });

    const groupsToList = groups => Object.keys(groups).map(key => groups[key]);

    const groupChats = reduce((acc, chat) => {
        const chatId = chat.chatId;
        return acc[chatId] == null
        ? assoc(chatId, [chat], acc)
        : assoc(chatId, acc[chatId].concat(chat), acc);
    }, {});

    await composeP(
        mergeChats,
        groupsToList,
        groupChats,
    )(chats);

    print("处理完毕");
})();
