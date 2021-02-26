import axios from "axios";
import {mongo, id as monkId} from "../lib/db";
import {endpoint, protect, unsafe, advancedResponse} from "../lib/api-helper";
import {buildQuery, createIdGenerator, escape, isWorkingTime} from "../helper";
import dayjs from "dayjs";
import fs from "fs";
import mime from "mime-types";
import {endpoints} from "../lib/endpoints";

const db = mongo.get("emails");
const accountDb = mongo.get("email_accounts");
const templates = mongo.get("templates");

const IS_PRODUCTION = process.env.NODE_ENV === "production";

const uuid = createIdGenerator();

const DEVELOPMENT_SETTINGS = {
    responseType: "json",
    baseURL: "https://mail.globus.furniture",
    auth: {
        username: "globus",
        password: "SQquP1oQQcOujhl59H",
    },
    proxy: false,
    timeout: 1000 * 60 * 60,
};

const PRODUCTION_SETTINGS = {
    responseType: "json",
    baseURL: "http://localhost:3000",
};

const limitation = {
    deleted_at: {$eq: null},
};

const MESSAGE_EVENT_HANDLERS = {
    messageNew: async ({account, data, path: boxPath}) => {
        console.log(`Event: messageNew, accountId: ${account}, id: ${data.id}`);
        const email = data?.from?.address;
        const globusEmail = await accountDb.findOne({name: email});
        const isRead = globusEmail != null;
        await db.insert(
            data?.to?.map(t => ({...data, to: {...t}, account, boxPath, isRead, deleted_at: null})) || {
                ...data,
                account,
                boxPath,
                isRead,
                deleted_at: null,
            },
        );
        const lead = await endpoints.leads.byEmail({email: data?.from});
        if (lead != null) {
            console.log("adding task...");
            endpoints.leads.change({lead: lead._id, key: "status_id", value: 23674579}, {login: "system"});
            endpoints.tasks.add(
                {
                    lead: lead._id,
                    text: `Ответить на email клиента [${data?.subject}]`,
                    priority: "high",
                },
                {login: "system"},
            );
        } else {
            console.log("got email, but lead not found");
        }
    },
    messageDeleted: async ({data, account}) => {
        console.log(`Event: messageDeleted, accountId: ${account}, id: ${data.id}`);
        await db.update({id: {$eq: data.id}}, {$set: {deleted_at: dayjs().toDate()}});
    },
    messageUpdated: async ({data, account}) => {
        console.log(`Event: messageUpdated, accountId: ${account}, id: ${data.id}`);
        if (data?.changes?.flags?.added?.includes("\\Seen")) {
            await db.findOneAndUpdate({id: data.id}, {$set: {isRead: true}});
        }
    },
};

const {get, post} = axios.create(IS_PRODUCTION ? PRODUCTION_SETTINGS : DEVELOPMENT_SETTINGS);

const downloadAttachment = async (accountId, attachmentId) => {
    const {data, headers} = await get(`/v1/account/${accountId}/attachment/${attachmentId}`, {
        responseType: "arraybuffer",
    });
    return {data, headers};
};

const getEmailMessageText = async (account, textId) => {
    const {data} = await get(`/v1/account/${account}/text/${textId}`);
    return data;
};

const generateFiltersQuery = async ({boxes, range = "all", readState = "all"}) => {
    const globusEmails = await accountDb.find();
    const emails = Array.isArray(boxes) && boxes.length > 0 ? boxes : globusEmails.map(gm => gm.name);

    const queryMap = {
        all: {$or: [{"from.address": {$in: emails}}, {"to.address": {$in: emails}}]},
        sent: {$or: [{"from.address": {$in: emails}}]},
        recieved: {$or: [{"to.address": {$in: emails}}]},
        read: {isRead: true},
        unread: {isRead: false},
    };

    return buildQuery([
        {
            condition: range in queryMap,
            query: queryMap[range] || {},
        },
        {
            condition: readState !== "all",
            query: queryMap[readState] || {},
        },
    ]);
};

const transporter = async ({account, options}) => {
    return await post(`/v1/account/${account}/submit`, options);
};

const readFilesAsBase64 = async (filenames = []) => {
    const dir = "/var/www/html/files/";

    return await Promise.all(
        filenames.map(async filename => {
            const filePath = dir + filename;
            const content = Buffer.from(fs.readFileSync(filePath)).toString("base64");
            return {
                filename,
                content,
                contentType: mime.lookup(filename),
                contentDisposition: "attachment",
                cid: uuid(),
                encoding: "base64",
            };
        }),
    );
};

const uploadMessage = (options, account) => {
    return post(`/v1/account/${account}/message`, options);
};

const noop = async () => {};

const retry = async ({
    maxTimes = 3,
    callback = noop,
    onError = noop,
    onSuccess = noop,
    onMaxTimesError = noop,
    initTimes = 1,
}) => {
    try {
        const result = await callback(initTimes);
        await onSuccess(result, initTimes);
        return result;
    } catch (error) {
        if (initTimes >= maxTimes) return await onMaxTimesError(error, initTimes);
        await onError(error, initTimes);
        return await retry({callback, onError, maxTimes, initTimes: initTimes + 1});
    }
};

const send = async (
    {
        subject,
        from,
        to,
        data,
        files = [],
        otherFiles = [],
        template,
        account,
        inReplyTo,
        senderName = "The Globus Limited",
    },
    {login = "system"} = {},
) => {
    const innerAttachments = await readFilesAsBase64(files);
    const mailOptions = {
        from: {name: senderName, address: from},
        to: [{address: to}],
        subject,
        text: data,
        html: data,
        // inReplyTo,
        // replyTo: from,
        // dsn: {
        //     id,
        //     return: "headers",
        //     notify: ["failure", "delay"],
        //     recipient: "info@globus.furniture",
        // },
        attachments: innerAttachments.concat(otherFiles),
        headers: {
            "In-Reply-To": inReplyTo,
        },
    };
    // try {
    //     const {data: info} = await transporter({account, options: mailOptions});
    //     console.log(login, "sent", template, "to", to);
    //     const path = await accountDb.findOne({account})?.path;
    //     path && uploadMessage({...mailOptions, path, messageId: info.messageId}, account);
    //     return info;
    // } catch (e) {
    //     console.log(template, "failed to send to", to, e?.response?.data);
    //     return {error: e.toString()};
    // }
    const {data: result, error} = await retry({
        callback: async () => transporter({account, options: mailOptions}),
        onError: async (error, times) => {
            console.log(login, "sent", template, "to", to, "times", times, "reson: ", error?.response?.data);
        },
        onSuccess: async ({data: info}, times) => {
            console.log(login, "sent", template, "to", to, "times", times);
            const path = await accountDb.findOne({account})?.path;
            path && uploadMessage({...mailOptions, path, messageId: info.messageId}, account);
        },
        onMaxTimesError: async error => ({error: {error: error.toString()}}),
    });
    if (error) {
        console.log("failed to send email: ", error);
    }
    return error ?? result;
};

export const emails = endpoint(
    {
        boxes: protect(
            user => user?.access?.mails?.canSeeMessages,
            async () => {
                const globusEmails = await accountDb.find();
                const addresses = globusEmails.map(({name}) => name);
                const groups = await db.aggregate([
                    {
                        $match: {
                            isRead: false,
                            $or: [{"from.address": {$in: addresses}}, {"to.address": {$in: addresses}}],
                            ...limitation,
                        },
                    },
                    {
                        $group: {_id: "$account", count: {$sum: 1}},
                    },
                ]);
                return globusEmails.map(gm => ({...gm, unreads: groups.find(g => g._id === gm.account)?.count || 0}));
            },
        ),
        messages: protect(
            user => user?.access?.mails?.canSeeMessages,
            async ({skip = 0, limit = 50, ...params}) => {
                try {
                    const query = await generateFiltersQuery(params);
                    const messages = await db.find({...query, ...limitation}, {skip, limit, sort: {date: -1}});
                    return messages.map(msg => ({
                        ...msg,
                        // from: msg?.from?.name ? `${msg.from.name} <${msg.from.address}>` : msg?.from?.address,
                        // to: msg?.to?.name ? `${msg.to.name} <${msg.to.address}>` : msg?.to?.address,
                        key: msg._id,
                    }));
                } catch (error) {
                    console.error(error);
                    return [];
                }
            },
        ),
        count: protect(
            user => user?.access?.mails?.canSeeMessages,
            async ({read, ...params}) => {
                try {
                    const query = await generateFiltersQuery(params);
                    return await db.count({...query, ...limitation});
                } catch (error) {
                    return error;
                }
            },
        ),
        message: protect(
            user => user?.access?.mails?.canSeeMessages,
            async ({account, textId, _id, hasLead}) => {
                try {
                    const {html, plain} = await getEmailMessageText(account, textId);
                    if (hasLead) await db.findOneAndUpdate({_id: monkId(_id)}, {$set: {isRead: true}});
                    return {content: html || plain};
                } catch (error) {
                    return error;
                }
            },
        ),
        byMessageId: protect(
            user => user?.access?.mails?.canSeeMessages,
            async ({messageId}) => {
                const message = await db.findOne({messageId});
                const {html = ""} = await getEmailMessageText(message?.account, message?.text?.id);
                return {
                    ...message,
                    html,
                    from: `${message?.from?.name} <${message?.from?.address}>`,
                    to: `${message?.to?.name} <${message?.to?.address}>`,
                };
            },
        ),
        attachment: protect(
            user => user?.access?.mails?.canSeeMessages,
            async ({account, attachmentId}) => {
                try {
                    const {data, headers} = await downloadAttachment(account, attachmentId);
                    return advancedResponse(200, data, headers);
                } catch (error) {
                    return error;
                }
            },
        ),
        send: protect(user => user?.access?.mailer?.canSendMessages, send),
        markRead: protect(
            user => user?.access?.mails?.canSeeMessages,
            ({ids, state = true}) => {
                db.update(
                    {_id: {$in: ids.map(id => monkId(id))}},
                    {
                        $set: {
                            isRead: state,
                        },
                    },
                    {multi: true},
                );
            },
        ),
    },
    {
        db,
        webhook: unsafe(async event => {
            (await MESSAGE_EVENT_HANDLERS[event.event]) && MESSAGE_EVENT_HANDLERS[event.event](event);
        }),
        autoresponse: unsafe(
            async ({language, name, email}) => {
                if (isWorkingTime()) {
                    return {result: "Working time"};
                }
                const templateName = language === "ru" ? "Автоответ" : "Autoresponse";
                const template = await templates.findOne({name: templateName});
                const subject = template.subject;
                const data = template.html.replace(/{{name}}/g, name);
                const mailOptions = {
                    from: "info@globus.furniture",
                    account: "info@globus.furniture",
                    to: email,
                    subject,
                    data,
                    template: template.name,
                };
                const sendResult = send(mailOptions, {login: "system"});
                endpoints.leads.getLeadByEmail({email}).then(lead => {
                    if (lead != null) {
                        //endpoints.notes.add({id: lead._id, text: "Sent autoresponse", });
                    }
                });
                return await sendResult;
            },
            ["emails"],
        ),
        getTemplate: async (template, tags = {}) => {
            const t = await templates.findOne({name: template});
            Object.keys(tags).forEach(tag => {
                t.html = t.html.replace(new RegExp(`{{${escape(tag)}}}`, "g"), tags[tag]);
            });
            return t;
        },
        unsubscribe: unsafe(
            async ({email}) => {
                const lead = await endpoints.leads.getLeadByEmail({email});
                if (lead != null) {
                    endpoints.notes.add(
                        {lead: lead._id, type: "text", text: "This user doesn't wish to receive our emails anymore"},
                        {login: "system"},
                    );
                }
                return lead;
            },
            ["emails"],
        ),
    },
);
