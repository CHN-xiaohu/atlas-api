import {endpoint, protect} from "../lib/api-helper";
import {mongo} from "../lib/db";

const defaults = {
    skip: 0,
    limit: 0,
    sort: {
        sort: 1,
    },
    projection: {},
};

const limitation = {};

const db = mongo.get("templates");

export const templates = endpoint(
    {
        get: protect(
            user => user?.access?.templates?.canSeeTemplates, //see
            async ({
                skip = defaults.skip,
                limit = defaults.limit,
                sort = defaults.sort,
                projection = defaults.projection,
            }) => {
                return await db.find({...limitation}, {skip, limit, sort, projection});
            },
        ),

        published: protect(
            user => user?.access?.templates?.canSeeTemplates, //see
            async ({params}) => {
                return db.find({published: true}, {...defaults, ...params});
            },
        ),

        save: protect(
            user => user?.access?.templates?.canEditTemplates, //edit
            async ({_id, template, html, published = false, name, language, tags, sort, subject, moveTo}) => {
                const t = await db.findOneAndUpdate(
                    {_id},
                    {
                        $set: {
                            template,
                            html,
                            published,
                            name,
                            language,
                            tags,
                            sort,
                            subject,
                            moveTo,
                        },
                    },
                );
                return t;
            },
            ["templates"],
        ),

        new: protect(
            user => user?.access?.templates?.canAddTemplates, //add
            async ({template}) => {
                const t = await db.insert(template);
                return t;
            },
            ["templates"],
        ),

        delete: protect(
            user => user?.access?.templates?.canDeleteTemplates, //delete
            ({_id}) => {
                return db.findOneAndDelete({_id});
            },
            ["templates"],
        ),
    },
    {
        db,
    },
);
