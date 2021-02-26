import {endpoint, protect, unsafe} from "../lib/api-helper";
import {mongo, id as monkid} from "../lib/db";

import dayjs from "dayjs";
import {readFile} from "fs";
import {availableLeads} from "../lib/leadsAccessControl";

const defaults = {
    skip: 0,
    limit: 0,
    sort: {
        time: -1,
    },
    projection: {},
};

const limitation = {};

const db = mongo.get("logs");

const forUser = async ({user}) => {
    if (typeof user !== "string") {
        return [];
    }
    return db.find({author: user});
};

export const logs = endpoint(
    {
        get: protect(
            user => user?.access?.users?.canSeeUsers, //see
            async ({
                type,
                event,
                from,
                to,
                user,
                skip = defaults.skip,
                limit = defaults.limit,
                sort = defaults.sort,
                projection = defaults.projection,
            }) => {
                const typeQuery = type == null ? {} : {type};
                const eventQuery = event == null ? {} : {event};
                const userQuery = user == null ? {} : {author: user};
                const periodQuery =
                    from == null || to == null
                        ? {}
                        : {
                              time: {
                                  $gte: dayjs(from).toDate(),
                                  $lte: dayjs(to).toDate(),
                              },
                          };
                return await db.find(
                    {...typeQuery, ...eventQuery, ...userQuery, ...periodQuery, ...limitation},
                    {skip, limit, sort, projection},
                );
            },
        ),

        forLead: protect(
            user => user?.access?.users?.canSeeUsers, //see
            async ({id, ...params}, {login, access}) => {
                if (
                    !access?.leads?.canSeeAllLeads &&
                    (await availableLeads(login)).find(l => l.toString() === id) == null
                ) {
                    return [];
                }
                return db.find({id: monkid(id), type: "lead"}, {...defaults, ...params});
            },
        ),

        byType: protect(
            user => user?.access?.users?.canSeeUsers, //see
            async ({type, id, ...params}) => {
                //console.log({type, id: monk.id(id)});
                return db.find({type, id: monkid(id)}, {...defaults, ...params});
            },
        ),

        delete: protect(
            user => user?.access?.users?.canDeleteUsers, //delete
            ({_id}) => {
                return db.findOneAndDelete({_id});
            },
            ["logs"],
        ),

        system: protect(
            user => user?.access?.logs?.canSeeSystemLogs,
            ({type}) => {
                const fileName = type === "system" ? "ai-server.log" : "ai-server.error";
                return new Promise((resolve, reject) => {
                    const path = `/var/log/caddy/${fileName}`;
                    //const tmp = '/var/log/system.log'
                    readFile(path, "utf8", (err, data) => {
                        if (err) {
                            reject(err);
                        }
                        resolve(data);
                    });
                });
            },
        ),
    },
    {
        db,
        add: unsafe(
            async log => {
                const data = {time: dayjs().toDate(), ...log};
                const inserted = await db.insert(data);
                return inserted._id;
            },
            ["logs"],
        ),

        forUser,

        forMe: async (a, {login}) => {
            return forUser({user: login});
        },
    },
);
