import {endpoints} from "./lib/endpoints.js";
import formidable from "express-formidable";
import dayjs from "dayjs";
import bodyParser from "body-parser";
import {getTaskCompleteTime} from "./helper.js";
import {requestHandler} from "./lib/api.js";
import {forex} from "./lib/forex.js";
import {notify} from "./lib/github";

const formdata = formidable({maxFileSize: 500 * 1024 * 1024});
const urlencoded = bodyParser.urlencoded({extended: true, limit: "500mb"});

const json = bodyParser.json({limit: "500mb"});

const universal = (req, res, next) => {
    const contentType = req.get("Content-Type");
    if (typeof contentType === "string") {
        if (contentType.includes("json")) {
            json(req, res, next);
        } else if (contentType.includes("urlencoded")) {
            urlencoded(req, res, next);
        } else if (contentType.includes("form-data")) {
            formdata(req, res, next);
        } else {
            next();
        }
    } else {
        next();
    }
};

export default {
    get: [
        [
            "/",
            (req, res) => {
                res.send("<h1>Welcome to the Atlas API server</h1>");
            },
        ],

        [
            "/forex",
            async (req, res) => {
                const rate = await forex();
                res.json(rate);
            },
        ],
        [
            "/redirect/:id",
            async (req, res) => {
                res.redirect(await endpoints.links.redirect(req.params));
            },
        ],
        [
            "/forex",
            async (req, res) => {
                const rate = await forex();
                res.json(rate);
            },
        ],
        [
            "/hook/adleads",
            async (req, res) => {
                console.log("new lead from facebook", req.query);
                const {name, phone, square, budget, property_type} = req.query;
                endpoints.leads.hook({
                    name,
                    phone: parseInt(phone),
                    area: parseInt(square.replace("от_", "")),
                    budget: budget.replace("_", ""),
                    source: "facebook",
                    metering: "м",
                    propertyType: {
                        дома: "Дом",
                        квартиры: "Квартира",
                        отеля: "Отель",
                        офиса: "Офис",
                    }[property_type],
                    details: Object.keys(req.query)
                        .map(key => `[${key}]: ${req.query[key]}`)
                        .join("\n"),
                    russian: true,
                });

                res.send("ok");
            },
        ],
        [
            "/images/:photo",
            async (req, res) => {
                const {photo} = req.params;
                const {session} = req.query;
                const user =
                    typeof session === "string" && session.length > 0 ? await endpoints.users.getUser(session) : null;
                const result = await endpoints.images.get({photo}, user);

                if (result == null) {
                    res.status(404).send("Not found");
                } else {
                    const {link, httpStatusCode} = result;
                    res.redirect(httpStatusCode, link);
                }
            },
        ],
        [
            "/files/:fileId",
            async (req, res) => {
                const {fileId} = req.params;
                const {session} = req.query;
                const user =
                    typeof session === "string" && session.length > 0 ? await endpoints.users.getUser(session) : null;

                const isLogin = user != null;

                const file = await endpoints.files.getFile({_id: fileId});

                if (file == null || (!isLogin && !file.isPublic)) {
                    res.status(404).send("Not Found");
                } else {
                    res.redirect(301, file.link);
                }
            },
        ],
        [
            "/schedule", //TODO replace with normal method
            async (req, res) => {
                const today = await endpoints.tasks.scheduleTasks();
                const next = await endpoints.tasks.scheduleTasks(getTaskCompleteTime(dayjs().add(1, "day")));
                res.json(today.concat(next));
            },
        ],
        [
            "/unsubscribe/:email",
            async (req, res) => {
                console.log(req.params.email, "unsubscribed");
                const lead = endpoints.emails.unsubscribe(req.params);
                if (lead != null) {
                    endpoints.notifications.sendNotification({
                        title: "User unsubscribed",
                        description: `${lead.contact_name ?? "user"} doesn't wish to receive our emails anymore`,
                        receivers: [], //TODO add receivers
                        priority: "middle",
                    });
                    res.send("Successfully unsubscribed");
                } else {
                    res.send("Email not found");
                }
            },
        ],
        [
            "/autoresponse/:language/:email/:name/",
            async (req, res) => {
                console.log(req.params);
                res.json(endpoints.emails.autoresponse(req.params));
            },
        ],
        [
            "/:endpoint/:method?",
            async (req, res) => {
                const {method, endpoint} = req.params;
                const session = req.get('Authorization') ?? req.query.session;
                const result = await requestHandler(endpoint, method ?? "get", session, req.query);
                if (result?._isAdvancedResponse) {
                    const {status, data, headers} = result;

                    if (Math.floor(result.status / 100) === 3) {
                        //redirect
                        res.set(headers).status(status).redirect(data);
                    } else {
                        if (Buffer.isBuffer(data)) {
                            res.set(headers).status(status).send(data);
                        } else {
                            res.set(headers).status(status).json(data);
                        }
                    }
                } else {
                    res.json(result);
                }
            },
        ],
    ],
    post: [
        [
            "/forex",
            universal,
            async (req, res) => {
                const rate = await forex();
                res.json(rate);
            },
        ],
        [
            //TODO put this logic to separate method and delete this endpoint
            "/files/upload/catalogue",
            universal,
            async (req, res) => {
                res.send(await endpoints.files.addFile(req.files, "catalogue"));
            },
        ],
        [
            "/notify/:method",
            universal,
            (req, res) => {
                const {method} = req.params;
                if (method === "lead") {
                    const {name, destination, message, lead} = req.body;
                    endpoints.notifications.sendNotification({
                        title: `New client ${name} ${destination}`,
                        description: message,
                        receivers: ["alena"],
                        priority: "low",
                        lead,
                    });
                    res.json({status: "ok"});
                }
            },
        ],
        [
            "/whatsapp/hook",
            universal,
            async (req, res) => {
                const {instanceId, messages, ack, chatUpdate, status} = req.body;

                if (chatUpdate != null) {
                    chatUpdate.forEach(data => {
                        endpoints.waChats.chatUpdated(data, instanceId);
                    });
                }

                if (messages != null) {
                    messages.forEach(data => {
                        endpoints.waMessages.newMessage(data, instanceId);
                    });
                }

                if (ack != null) {
                    ack.forEach(data => {
                        endpoints.waMessages.messageUpdated(data);
                    });
                }

                if (status != null) {
                    endpoints.waChats.syncStatus(instanceId);
                }

                res.json({result: "ok"});
            },
        ],
        [
            "/jivosite",
            universal,
            async (req, res) => {
                const result = await endpoints.chats.hook(req.body);
                res.json(result);
            },
        ],
        [
            "/imap",
            universal,
            async (req, res) => {
                //const result = await endpoints.chats.hook(req.body)
                console.log("email hook");
                await endpoints.emails.webhook(req.body);
                res.json({result: "ok", success: true, error: null, errors: null, code: 200});
            },
        ],
        [
            "/github",
            universal,
            async (req, res) => {
                //const result = await endpoints.chats.hook(req.body);
                const event = req.get("X-GitHub-Event");
                console.log("github hook");
                try {
                    notify(event, req.body);
                } catch (e) {
                    console.log(e);
                }
                res.json({status: "ok"});
            },
        ],
        [
            //TODO put this logic to separate method and delete this endpoint
            "/files/upload/file",
            universal,
            async (req, res) => {
                const {isPublic} = req.fields;
                res.json(await endpoints.files.addFile(req.files, "file", isPublic === "true" || isPublic === true));
            },
        ],
        [
            //TODO put this logic to separate method and delete this endpoint
            "/images/upload",
            universal,
            async (req, res) => {
                const {session} = req.query;
                const {isPublic, expireIn, showImmediately} = req.fields;

                const file = req.files[Object.keys(req.files)[0]];

                if (file == null) return null;

                const user =
                    typeof session === "string" && session.length > 0 ? await endpoints.users.getUser(session) : null;
                const result = await endpoints.images.upload(
                    {
                        file,
                        isPublic: isPublic === "true" || isPublic === true,
                        expireIn: expireIn === undefined ? dayjs().add(1, "year").toDate() : dayjs(expireIn).toDate(),
                        showImmediately: showImmediately === "true" || showImmediately === true,
                    },
                    user,
                );
                res.json(result); // response {id: 'xxxxx'}, or null if user is null (TODO: response null)
            },
        ],
        [
            "/:endpoint/:method?",
            universal,
            async (req, res) => {
                const {method, endpoint} = req.params;
                const session = req.get("Authorization");
                const result = await requestHandler(endpoint, method ?? "get", session, req.body);
                if (result?._isAdvancedResponse) {
                    const {status, data, headers} = result;

                    if (Math.floor(result.status / 100) === 3) {
                        //redirect
                        res.set(headers).status(status).redirect(data);
                    } else {
                        if (Buffer.isBuffer(data)) {
                            res.set(headers).status(status).send(data);
                        } else {
                            res.set(headers).status(status).json(data);
                        }
                    }
                } else {
                    res.json(result);
                }
            },
        ],
    ],
};
