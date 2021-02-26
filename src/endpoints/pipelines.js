import {endpoint, protect} from "../lib/api-helper";
import {mongo} from "../lib/db";

const defaults = {
    skip: 0,
    limit: 0,
    projection: {},
    sort: {
        sort: 1,
    },
};

const db = mongo.get("pipelines");

export const pipelines = endpoint(
    {
        get: protect(
            user => user?.access?.leads?.canSeePipelines,
            () => db.find({}, {...defaults})
        ),
        active: protect(
            user => user?.access?.leads?.canSeePipelines, //see
            () => db.find({id: {$nin: [142, 143]}}, {...defaults}),
        ),
    },
    {
        db,
    },
);
