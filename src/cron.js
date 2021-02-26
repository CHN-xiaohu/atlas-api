import {endpoints} from "./lib/endpoints";
import dayjs from "dayjs";
import {getTaskCompleteTime, leadName, parseNumber} from "./helper";
import monk from "monk";
import cron from "node-cron";

const findUnansweredMessages = async instance => {
    const lastMessages = await endpoints.waMessages.db.aggregate([
        {$match: {instance_number: instance}},
        {
            $group: {
                _id: "$chatId",
                chatId: {$last: "$chatId"},
                body: {$last: "$body"},
                time: {$last: "$time"},
                type: {$last: "$type"},
                fromMe: {$last: "$fromMe"},
            },
        },
        {$sort: {time: -1}},
        {$limit: 100},
    ]);
    const unansweredMessages = lastMessages.filter(
        message =>
            message.type === "chat" &&
            !message.fromMe &&
            message.body.includes("?") &&
            dayjs.unix(message.time).isBefore(dayjs().subtract(1, "hour")),
    );

    // eslint-disable-next-line immutable/no-let
    for (let message of unansweredMessages) {
        const number = parseNumber(message.chatId);
        const lead = await endpoints.leads.db.findOne({$or: [{phone: number}, {whatsapp: number}]});
        if (lead != null) {
            //find active tasks
            const chat = await endpoints.waChats.db.findOne({last_message_time: {$ne: null}, chatId: message.chatId});
            if (chat?.metadata?.isGroup === true) {
                console.log("skipping unanswered message because it's in group", message.chatId);
                return;
            }
            const tasks = await endpoints.tasks.db.find({status: false, lead: monk.id(lead._id)});
            if (tasks.length === 0) {
                //set task
                const text = `Answer the WhatsApp message: ${message.body}`;
                const count = await endpoints.tasks.db.count({text, lead: monk.id(lead._id)});
                //console.log(count);
                if (count === 0) {
                    endpoints.tasks.add({
                        completeTill: getTaskCompleteTime(dayjs(), "high"),
                        text,
                        lead: monk.id(lead._id),
                        priority: "high",
                    });
                    console.log(message.body, "setting reminder task");
                }
            }
        }
    }
};

const cache = {};

const checkWhatsAppStatus = async instance => {
    const cacheKey = `disconnect-${instance}`;
    if (cache[cacheKey] == null || dayjs().startOf("day").isAfter(dayjs(cache[cacheKey]))) {
        const status = await endpoints.waChats.status({instance});
        if (status !== "authenticated" && status !== "phone_disconnected") {
            console.log(instance, status);
            cache[cacheKey] = dayjs();
            endpoints.notifications.sendNotification({
                description:
                    'Whatsapp server is probably disconnected. Please proceed to <a href="https://mercury.chat">https://mercury.chat</a> and reauthorize if necessary',
                receivers: [instance === "L15780318138712" ? "alena" : "maria"],
            });
        }
        return status;
    }
    return "authenticated";
};

// eslint-disable-next-line immutable/no-let
let timers = [ ];

const IS_PRODUCTION = process.env.NODE_ENV === "production";

const scheduleTasksOverdue = async () => {
    const tasks = await endpoints.tasks.db.find({
        status: false,
        complete_till: {
            $gte: dayjs().toDate(),
            $lte: dayjs().add(2, "hour").toDate(),
        },
    });
    //clear timers
    timers.forEach(timer => clearTimeout(timer));
    //set new timeouts
    timers = tasks.map(task => {
        //console.log('scheduled task overdue', dayjs(task.complete_till).format('HH:mm'), task.text, task.responsible);
        return setTimeout(async () => {
            const t = await endpoints.tasks.db.findOne({_id: monk.id(task._id)});
            if (t.status === false) {
                //send notifications
                const lead = await endpoints.leads.db.findOne({_id: monk.id(task.lead)});
                endpoints.notifications.sendNotification({
                    title: `${leadName(lead)} task overdue`,
                    description: task.text,
                    receivers: task.responsible == null ? ["andrei", "maria", "alena"] : [task.responsible],
                    priority: task.priority,
                    lead: task.lead,
                    trigger: ["tasks"],
                    action: "overdue",
                });
            }
        }, dayjs(task.complete_till).valueOf() - dayjs().valueOf());
    });
};
const instances = ["195837", "195780", "213509"];

const actions = [
    {
        condition: IS_PRODUCTION,
        timer: "10,20,30,40,50,0 * * * *",
        action: async () => {

            // eslint-disable-next-line immutable/no-let
            for (let instance of instances) {
                const status = await checkWhatsAppStatus(instance);
                if (status === "authenticated" || status === "phone_disconnected") {
                    findUnansweredMessages(instance);
                } else {
                    console.log(`status of ${instance} is ${status}, so not checking messages`);
                }
            }
        }
    },
    {
        condition: IS_PRODUCTION,
        timer: "0 9,12,15,18 * * 1-5",
        action: async () => {
            const today = await endpoints.tasks.scheduleTasks();
            const next = await endpoints.tasks.scheduleTasks(getTaskCompleteTime(dayjs().add(1, "day")));
            //res.json(today.concat(next));
            const tasks = today.concat(next);
            console.log("[scheduler]", "scheduled", tasks.length, "tasks");
        }
    },
    {
        condition: IS_PRODUCTION,
        timer: "36 * * * *",
        action: scheduleTasksOverdue
    }
]

actions.forEach(({action, timer, condition = true}) => {
    if (condition) {
        cron.schedule(timer, action)
    }
})
