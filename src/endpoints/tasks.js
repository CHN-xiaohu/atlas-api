import {endpoint, protect, unsafe} from "../lib/api-helper";
import {id as monkid, mongo} from "../lib/db";
import {endpoints} from "../lib/endpoints";

import dayjs from "dayjs";
import {escapedRegExp, getTaskCompleteTime, leadName, phoneCallTime, rateClient} from "../helper";
import isSameOrAfter from "dayjs/plugin/isSameOrAfter";
import numberToTimezone from "timezone-mapper";
import {availableLeads} from "../lib/leadsAccessControl";

dayjs.extend(isSameOrAfter);

const defaults = {
    skip: 0,
    limit: 0,
    projection: {},
};

const limitation = {
    deleted_at: {$exists: false},
};

const db = mongo.get("tasks");
const leadsDb = mongo.get("leads");
const rulesDb = mongo.get("rules");
const assignmentsDb = mongo.get("assignments");

const tasksSearchQuery = search => {
    if (typeof search !== "string" || search.length === 0) {
        return {};
    }
    const searchRegex = escapedRegExp(search, "i");
    return {
        $or: [
            {text: {$regex: searchRegex}},
            {result: {$regex: searchRegex}},
            {lead: {$regex: searchRegex}},
            {_id: {$regex: searchRegex}},
        ],
    };
};

const add = async (
    {completeTill = getTaskCompleteTime(), text, lead, status = false, priority = "middle", bonus, responsible},
    {login} = {},
) => {
    const author = login || "system";
    const l = await leadsDb.findOne({_id: lead});
    if (l == null) return;
    console.log("add task for", responsible ?? l.responsible ?? "everyone", lead, l._id, text);
    const t = await db.insert({
        complete_till: dayjs(completeTill).toDate(),
        priority,
        text,
        lead: monkid(lead),
        status,
        author,
        responsible: responsible ?? l.responsible,
        bonus: bonus ?? rateClient(l),
        created_at: dayjs().toDate(),
        updated_at: dayjs().toDate(),
    });

    endpoints.logs.add({
        id: t._id,
        type: "task",
        event: "add",
        author,
    });
    return t;
};

const deleteMethod = ({_id}, {login} = {}) => {
    endpoints.logs.add({
        task: _id,
        type: "task",
        event: "delete",
        author: login || "system",
    });
    return db.findOneAndUpdate({_id}, {$set: {deleted_at: dayjs().toDate()}});
    //this.updateTasks([], [task]);
};

const reassign = ({_id, responsible}, {login} = {}) => {
    endpoints.logs.add({
        task: _id,
        type: "task",
        to: responsible,
        event: "reassign",
        author: login || "system",
    });
    return db.findOneAndUpdate(
        {_id},
        {
            $set: {
                responsible,
                updated_at: dayjs().toDate(),
            },
        },
    );
};

const forLeads = async (
    {
        leads = [],
        status,
        skip = defaults.skip,
        limit = defaults.limit,
        projection = defaults.projection,
        sort = defaults.sort,
    },
    {login, access},
) => {
    if (leads.length === 0) return [];
    //console.log(leads.map(lead => monkid(lead)));
    const statusQuery = status == null ? {} : {status};
    return db.find(
        {
            lead: {
                $in: !access?.leads?.canSeeAllLeads
                    ? (await availableLeads(login)).filter(lead => leads.includes(lead.toString()))
                    : leads.map(lead => monkid(lead)),
            },
            ...statusQuery,
            ...limitation,
        },
        {skip, limit, sort, projection},
    );
};

export const tasks = endpoint(
    {
        forLeads: protect(
            user => user?.access?.tasks?.canSeeTasks, //see
            forLeads,
        ),

        activeForLeads: protect(
            user => user?.access?.tasks?.canSeeTasks, //see
            async ({leads = []}, user) => {
                return endpoints.tasks.forLeads({leads, status: false}, user);
            },
        ),

        active: protect(
            user => user?.access?.tasks?.canSeeTasks, //see
            async ({search, responsible, ...params}, {login, access}) => {
                const responsibleQuery = responsible == null ? {} : {$or: [{responsible}, {responsible: {$eq: null}}]};
                const managerQuery = !access?.leads?.canSeeAllLeads ? {lead: {$in: await availableLeads(login)}} : {};
                return db.find(
                    {
                        status: false,
                        ...responsibleQuery,
                        ...tasksSearchQuery(search),
                        ...managerQuery,
                        ...limitation,
                    },
                    {...defaults, ...params},
                );
            },
        ),

        withinInterval: protect(
            user => user?.access?.tasks?.canSeeTasks, //see
            async ({from, to, responsible}, {login, access}) => {
                const responsibleQuery =
                    responsible == null
                        ? {}
                        : {
                              responsible,
                          };
                const managerQuery = !access?.leads?.canSeeAllLeads ? {lead: {$in: await availableLeads(login)}} : {};
                return db.find(
                    {
                        complete_till: {
                            $gte: dayjs(from).toDate(),
                            $lte: dayjs(to).toDate(),
                        },
                        ...responsibleQuery,
                        ...managerQuery,
                        ...limitation,
                    },
                    {
                        ...defaults,
                        projection: {},
                    },
                );
            },
        ),

        complete: protect(
            user => user?.access?.tasks?.canCloseTasks, //close
            async ({_id, result, id}, {login}) => {
                if (id != null) {
                    console.log("reschedule", "deprecated call");
                }
                const task = await db.findOneAndUpdate(
                    {_id},
                    {
                        $set: {
                            status: true,
                            result,
                            updated_at: dayjs().toDate(),
                            completed_by: login,
                        },
                    },
                );
                endpoints.logs.add({
                    task: _id,
                    type: "task",
                    event: "complete",
                    text: task.text,
                    lead: task.lead,
                    result,
                    author: login,
                });
            },
            ["tasks"],
        ),

        reschedule: protect(
            user => user?.access?.tasks?.canRescheduleTasks, //reschedule
            ({_id, time}, {login} = {}) => {
                endpoints.logs.add({
                    task: _id,
                    type: "task",
                    to: dayjs(time).toDate(),
                    event: "reschedule",
                    author: login || "system",
                });
                return db.findOneAndUpdate(
                    {_id},
                    {
                        $set: {
                            complete_till: dayjs(time).toDate(),
                            updated_at: dayjs().toDate(),
                        },
                    },
                );
            },
            ["tasks"],
        ),

        reassign: protect(
            user => user?.access?.tasks?.canReassignTasks, //reassign
            reassign,
            ["tasks"],
        ),

        adjustTime: protect(
            user => user?.access?.tasks?.canEditTasks, //edit
            async ({_id}) => {
                const task = await db.findOne({_id});
                const lead = await endpoints.leads.db.findOne({_id: task.lead});
                const number = lead.phone ?? lead.whatsapp;
                // eslint-disable-next-line immutable/no-let
                let completeTill = getTaskCompleteTime();
                if (number != null) {
                    const tz = numberToTimezone(number, true);
                    if (tz != null) {
                        completeTill = phoneCallTime(tz, dayjs(completeTill));
                    }
                }
                //console.log(completeTill.toDate());
                //this.updateTasks([updatedTask]);
                return await db.findOneAndUpdate({_id}, {$set: {complete_till: dayjs(completeTill).toDate()}});
            },
            ["tasks"],
        ),

        add: protect(
            user => user?.access?.tasks?.canAddTasks, //add
            add,
            ["tasks"],
        ),

        delete: protect(
            user => user?.access?.tasks?.canDeleteTasks, //delete
            deleteMethod,
            ["tasks"],
        ),
    },
    {
        db,
        add: unsafe(add, ["tasks"]),
        delete: unsafe(deleteMethod, ["tasks"]),
        reassign: unsafe(reassign, ["tasks"]),
        forLeads,
        scheduleTasks: unsafe(
            async (markerLine = dayjs(), verbose = false) => {
                const now = dayjs(markerLine);
                const schedulerLog = verbose ? (...args) => console.info("[scheduler]", ...args) : () => 1;
                const rules = await rulesDb.find({active: true});
                const pipelines = (await endpoints.pipelines.db.find({id: {$gt: 150}}))
                    .map(pipe => ({
                        ...pipe,
                        rules: rules.filter(rule => rule.id === pipe.id || rule.id === 0),
                    }))
                    .filter(pipe => pipe.rules.length > 0);
                const leads = await leadsDb.find({
                    status_id: {$in: pipelines.map(p => p.id)},
                    deleted_at: {$exists: false},
                });
                //console.log(pipelines);
                // eslint-disable-next-line immutable/no-let
                let tasks = [];
                // eslint-disable-next-line immutable/no-let
                let assignments = [];
                // eslint-disable-next-line immutable/no-let
                for (let lead of leads) {
                    const {status_id, _id, doNotDisturbTill, created_at} = lead;
                    const leadLog = (...args) => schedulerLog(leadName(lead), ...args);
                    const pipeline = pipelines.find(pipe => pipe.id === status_id);
                    // eslint-disable-next-line immutable/no-let
                    for (let rule of pipeline.rules) {
                        const {days, task, unique, once, relativeTo, priority, newerThanUpdate, taskFor} = rule;
                        const log = (...args) => leadLog(task, "=>", ...args);
                        const latestTask = await endpoints.tasks.db.findOne(
                            {lead: monkid(_id), status: true, deleted_at: {$exists: false}},
                            {sort: {updated_at: -1}},
                        );
                        //console.log(latestTask);
                        // eslint-disable-next-line immutable/no-let
                        let lastUpdate = latestTask == null ? dayjs(created_at) : dayjs(latestTask.updated_at);
                        if (relativeTo != null) {
                            if (lead[relativeTo] != null) {
                                lastUpdate = dayjs(lead[relativeTo]);
                            } else {
                                continue;
                            }
                        }

                        if (doNotDisturbTill != null) {
                            const doNotDisturb = dayjs(doNotDisturbTill);
                            if (dayjs(doNotDisturb).isAfter(now)) {
                                log("Client marked not to disturb till", dayjs(doNotDisturb).format("D MMMM"));
                                continue;
                            } else {
                                log("Do not disturb date is in the past");
                            }
                        }
                        if (
                            unique === true &&
                            (await endpoints.tasks.db.count({
                                lead: monkid(_id),
                                status: false,
                                deleted_at: {$exists: false},
                            })) > 0
                        ) {
                            //const anotherTask = await endpoints.tasks.db.findOne({lead: monkid(_id), status: false, deleted_at: {$exists: false}})
                            log("Another task is already set");
                            continue;
                        }
                        if (once === true) {
                            const count = await assignmentsDb.count({task, lead: monkid(lead._id)});
                            if (count > 0) {
                                log("This task has been set before");
                                continue;
                            }
                        }
                        newerThanUpdate && console.log(dayjs(doNotDisturbTill).isAfter(lastUpdate));
                        if (newerThanUpdate && dayjs(doNotDisturbTill).isAfter(lastUpdate)) {
                            continue;
                        }
                        const startingPoint = lastUpdate;
                        const candidate = startingPoint.add(days, "day");
                        const rubicone = candidate.isBefore(now) ? now : candidate;
                        if (!now.isSameOrAfter(rubicone, "day")) {
                            log("Time is yet to come", rubicone.format("D MMMM"));
                            continue;
                        }

                        if (once === true) {
                            assignments.push({task, lead: monkid(lead._id)});
                        }

                        // eslint-disable-next-line immutable/no-let
                        let completeTill = dayjs(getTaskCompleteTime(rubicone));
                        const number = lead.phone ?? lead.whatsapp;
                        if (number != null) {
                            const tz = numberToTimezone(number, true);
                            if (tz != null) {
                                completeTill = phoneCallTime(tz, dayjs(completeTill));
                            }
                        }
                        if (taskFor === "managers") {
                            if (Array.isArray(lead.managers)) {
                                const managers = await endpoints.users.db.find({login: {$in: lead.managers}});
                                lead.managers.forEach(manager => {
                                    //TODO change this behavior
                                    const login = managers.find(u => u.login === manager)?.login;
                                    if (typeof login === "string") {
                                        tasks.push({
                                            lead: lead._id,
                                            completeTill,
                                            text: task,
                                            responsible: login,
                                            priority: priority ?? "middle",
                                        });
                                    }
                                });
                            }
                        } else {
                            tasks.push({
                                lead: lead._id,
                                completeTill,
                                text: task,
                                responsible: lead.responsible,
                                priority: priority ?? "middle",
                            });
                        }
                    }
                }
                if (assignments.length > 0) {
                    //console.log(assignments);
                    assignmentsDb.insert(assignments);
                }
                //console.log(tasks);
                const scheduledTasks = await Promise.all(tasks.map(task => add(task, {})));
                if (scheduledTasks.length > 0) {
                    //this.updateTasks(scheduledTasks);
                    endpoints.notifications.sendNotification({
                        title: `Atlas Scheduler`,
                        description: `Assigned ${scheduledTasks.length} new tasks`,
                        receivers: ["alena", "maria"],
                        action: "taskScheduled",
                        priority: "low",
                    });
                }

                if (tasks.length === 0) {
                    console.log("no new tasks");
                }

                return tasks;
            },
            ["tasks"],
        ),
    },
);
