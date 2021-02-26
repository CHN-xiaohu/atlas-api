import dayjs from "dayjs";

import {endpoints} from "../lib/endpoints";
import {availableLeads} from "../lib/leadsAccessControl";
import {mongo, id} from "../lib/db";
import {endpoint, protect, unsafe} from "../lib/api-helper";

const db = mongo.get("notes");

const defaults = {
    projection: {},
    skip: 0,
    limit: 0,
    sort: {
        _id: 1,
    },
};

const add = async ({type = "text", lead, ...fields}, {login} = {}) => {
    const author = login || "system";
    const inserted = await db.insert({
        type,
        lead: id(lead),
        ...fields,
        created_at: dayjs().toDate(),
        author,
        updated_at: dayjs().toDate(),
    });
    endpoints.logs.add({
        type: "note",
        event: "add",
        id: inserted._id,
        author,
        lead,
    });
    return inserted;
};

export const notes = endpoint(
    {
        add: protect(user => user?.access?.leads?.canAddNotes, add, ["notes"]),
        forLeads: protect(
            user => user?.access?.leads?.canSeeNotes,
            async (
                {
                    leads = [],
                    skip = defaults.skip,
                    limit = defaults.limit,
                    projection = defaults.projection,
                    sort = defaults.sort,
                },
                {access, login},
            ) => {
                if (!Array.isArray(leads) || leads.length === 0) {
                    return [];
                }
                return db.find(
                    {
                        lead: {
                            $in: !access?.leads?.canSeeAllLeads
                                ? (await availableLeads(login)).filter(lead => leads.includes(lead.toString()))
                                : leads.map(lead => id(lead)),
                        },
                    },
                    {...defaults, skip, limit, sort, projection},
                );
            },
        ),
    },
    {
        db,
        add: unsafe(add, ["notes"]),
    },
);
