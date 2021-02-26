import {endpoint, protect, unsafe, open} from "../lib/api-helper";
import {mongo} from "../lib/db";

const SHORT_LINK_PREFIX = "https://qr.globus.world/";
const IS_PRODUCTION = process.env.NODE_ENV === "production";

const defaults = {
    skip: 0,
    limit: 0,
    projection: {
        //_id: 1,
    },
};

const limitation = {};

const db = mongo.get("links");

const genID = (length = 4) => {
    // eslint-disable-next-line immutable/no-let
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    // eslint-disable-next-line immutable/no-let
    for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

const getShortLinkById = id => SHORT_LINK_PREFIX + id;

export const links = endpoint(
    {
        get: protect(
            user => user?.access?.links?.canSeeLinks,
            async ({
                skip = defaults.skip,
                limit = defaults.limit,
                sort = defaults.sort,
                projection = defaults.projection,
            }) => {
                return await db.find({...limitation}, {skip, limit, sort, projection});
            },
        ),

        add: protect(
            user => user?.access?.links?.canAddLinks, //add
            ({id, link}) => {
                return db.insert({id, link});
            },
            ["links"],
        ),

        conventToShortLink: open(
            async ({link}) => {
                if (!IS_PRODUCTION) return link;
                const oldResult = await db.findOne({...limitation, link});
                if (oldResult != null) return getShortLinkById(oldResult.id);

                // eslint-disable-next-line immutable/no-let
                let maxRetryTimes = 10;
                // eslint-disable-next-line immutable/no-let
                let id;
                // eslint-disable-next-line immutable/no-let
                let existing;
                do {
                    id = genID();
                    existing = await db.findOne({...limitation, id});
                } while(existing != null && maxRetryTimes--);

                const newResult = await db.insert({id, link});
                return getShortLinkById(newResult.id);
            }
        ),
    },
    {
        db,

        redirect: unsafe(
            async ({id}) => {
                const link = await db.findOneAndUpdate({id}, {$inc: {views: 1}});
                if (link != null) {
                    return link.link;
                }
                return "https://globus-china.com";
            },
        ),
    },
);
