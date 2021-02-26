import {endpoint, protect, unsafe} from "../lib/api-helper";
import {mongo} from "../lib/db";
import {endpoints} from "../lib/endpoints";

import {wechatPost} from "../lib/qiyeweixin";

const db = mongo.get("notifications");

const sendNotification = async ({title, description, receivers, lead}) => {
    const AGENTID = 1000009;

    const users = await endpoints.users.db.find({login: {$in: receivers}});
    const qiyeweixin = users
        .filter(user => typeof user.qiyeweixin === "string" && user.qiyeweixin.length > 0)
        .map(user => user.qiyeweixin);

    const message =
        title == null
            ? description
            : `<a href="https://atlas.globus.furniture/leads/${lead}">${title}</a>
${description}`;

    if (process.env.NODE_ENV === "production") {
        await wechatPost("message/send", {
            touser: qiyeweixin.join("|"),
            msgtype: "text",
            agentid: AGENTID,
            text: {
                content: message,
            },
        });
    } else {
        console.log(message)
    }

};

export const notifications = endpoint(
    {
        sendNotification: protect(user => user?.access?.notifications?.canSendNotifications, sendNotification, [
            "notifications",
        ]),
    },
    {
        db,
        sendNotification: unsafe(sendNotification, ["notifications"]),
    },
);
