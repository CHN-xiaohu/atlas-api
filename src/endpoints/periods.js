import {endpoint, protect} from "../lib/api-helper";
import {mongo} from "../lib/db";
import {endpoints} from "../lib/endpoints";
const limitation = {};
const db = mongo.get("periods");

export const periods = endpoint(
    {
        get: protect(
            user => user?.access?.schedule?.canSeePeriod, //see
            async ({from, to, managers, ...params}, {login}) => {
                return db.find(
                    {
                        start: {$gte: new Date(from)},
                        end: {$lte: new Date(to)},
                        manager: login != null ? login : {$in: managers},
                        ...limitation,
                    },
                    {...{projection: {}}, ...params},
                );
            },
        ),

        add: protect(
            user => user?.access?.schedule?.canAddPeriod, //add //canAddPeriod
            async ({manager, start, end, note, workingDays}, {login}) => {
                const p = await db.insert({manager, start, end, note, workingDays});
                endpoints.logs.add({
                    type: "period",
                    event: "add",
                    author: login,
                    id: p._id,
                });
            },
            ["periods"],
        ),

        edit: protect(
            user => user?.access?.schedule?.canEditPeriod, //edit
            ({_id, manager, start, end, note, workingDays}) => {
                return db.findOneAndUpdate({_id}, {$set: {manager, start, end, note, workingDays}});
            },
            ["periods"],
        ),

        delete: protect(
            user => user?.access?.schedule?.canDeletePeriod, //delete
            ({_id}) => {
                return db.findOneAndDelete({_id});
            },
            ["periods"],
        ),
    },
    {
        db,
    },
);
