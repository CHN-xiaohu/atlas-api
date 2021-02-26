import {endpoint, protect} from "../lib/api-helper";
import {mongo} from "../lib/db";
import {endpoints} from "../lib/endpoints";

import dayjs from "dayjs";

const db = mongo.get("dictionaries");

const defaults = {
    projection: {},
};

const limitation = {
    deleted_at: {$exists: false},
}

export const dictionaries = endpoint(
    {
        byName: protect(
            user => user?.access?.dictionary?.canSeeDictionary,
            async ({name}) => {
                return db.findOne({name, ...limitation}, {...defaults});
            }
        ),

        get: protect(
            user => user?.access?.dictionary?.canSeeDictionary,
            async () => {
                return db.find({...limitation}, {...defaults});
            }
        ),

        add: protect(
            user => user?.access?.dictionary?.canAddDictionary,
            async ({name}, {login} = {}) => {
                const author = login || "system";

                const inserted = await db.insert({
                    name,
                    words: [],
                    created_at: dayjs().toDate(),
                    updated_at: dayjs().toDate(),
                });

                endpoints.logs.add({
                    type: "dictionary",
                    event: "add",
                    id: inserted._id,
                    author,
                });
                return inserted;
            },
            ['dictionaries']
        ),

        addWord: protect(
            user => user?.access?.dictionary?.canAddWord,
            async ({dictionary, word}) => {
                return db.findOneAndUpdate(
                    {_id: dictionary},
                    {
                        $push: {words: word},
                        $set: {updated_at: dayjs().toDate()},
                    },
                );
            },
            ['dictionaries']
        ),

        changeWord: protect(
            user => user?.access?.dictionary?.canChangeWord,
            async ({dictionary, key, prop, value}) => {
                return db.findOneAndUpdate(
                    {_id: dictionary, "words.key": key},
                    {$set: {updated_at: dayjs().toDate(), [`words.$.${prop}`]: value}},
                );
            },
            ['dictionaries']
        ),

        removeWord: protect(
            user => user?.access?.dictionary?.canRemoveWord,
            async ({_id, key}) => {
                return db.findOneAndUpdate({_id: _id}, {$pull: {words: {key}}});
            },
            ['dictionaries']
        ),

        removeDictionary: protect(
            user => user?.access?.dictionary?.canDeleteDictionary,
            async ({_id}) => {
                return db.findOneAndUpdate({_id}, {$set: {deleted_at: dayjs().toDate()}});
                //return db.findOneAndDelete({_id});
            },
            ['dictionaries']
        )
    },
    {
        db
    }
);
