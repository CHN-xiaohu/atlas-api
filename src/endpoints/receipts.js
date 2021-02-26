import {endpoint, protect} from "../lib/api-helper";
import {mongo, id as monkid} from "../lib/db";
import {endpoints} from "../lib/endpoints";
import {changePosition, deleteWithPosition, buildQuery} from "../helper";

import dayjs from "dayjs";

const limitation = {
    deleted_at: {$eq: null},
};

const db = mongo.get("receipts");

export const receipts = endpoint(
    {
        forLeads: protect(
            user => user?.access?.leads?.canSeePurchases, //leads see
            async ({leads}) => {
                if (leads == null || leads.length === 0) {
                    return [];
                }

                return db.aggregate([
                    {
                        $match: {
                            lead: {$in: leads.map(lead => monkid(lead))},
                            ...limitation,
                        },
                    },
                    {
                        $lookup: {
                            from: "new_purchases",
                            localField: "_id",
                            foreignField: "receipt",
                            as: "purchases",
                        },
                    },
                    {
                        $set: {
                            purchasesCount: {
                                $size: {
                                    $filter: {
                                        input: "$purchases",
                                        as: "p",
                                        cond: {
                                            $or: [
                                                {$eq: [{$type: "$$p.deleted_at"}, "missing"]},
                                                {$eq: ["$$p.deleted_at", null]},
                                            ],
                                        },
                                    },
                                },
                            },
                        },
                    },
                    {
                        $project: {
                            purchases: 0,
                        },
                    },
                    {$sort: {sort: 1}},
                ]);
            },
        ),

        update: protect(
            user => user?.access?.leads?.canEditPurchases, //edit
            async ({_id, key, val}, {login}) => {
                val = key.includes("Date") ? dayjs(val).toDate() : val;
                const newValue = {[key]: val, updated_at: dayjs().toDate()};
                const resetConfirm = ["sumForClient", "interest", "shippingForUs", "deposit", "depositForUs"].includes(key) ? {confirmDate: null} : {}
                const p = await db.findOneAndUpdate(
                    {_id},
                    {
                        $set: key === "status" ? {...newValue, ...resetConfirm, estimatedDate: null} : {...newValue, ...resetConfirm},
                    },
                );

                endpoints.logs.add({
                    receipt: p._id,
                    type: "receipt",
                    event: "change",
                    author: login,
                });

                return p;
            },
            ["receipts"],
        ),
        multiUpdate: protect(
            user => user?.access?.leads?.canEditPurchases, //edit
            async ({ids, values}, {login}) => {
                values = Object.entries(values)
                    .map(([key, val]) => [key, key.includes("Date") ? dayjs(val).toDate() : val])
                    .reduce(
                        (result, [key, val]) => {
                            result[key] = val
                            return result
                        },
                        {}
                    );
                const newValue = {...values, updated_at: dayjs().toDate()};
                const p = await db.update(
                    {_id: {$in: [].concat(ids).map(id => monkid(id))}},
                    {
                        $set: Object.keys(values).includes("status") ? {...newValue, estimatedDate: null} : newValue,
                    },
                    {multi: true},
                );

                endpoints.logs.add({
                    receiptIds: ids,
                    type: "receipt",
                    event: "multiUpdate",
                    author: login,
                });

                return p;
            },
            ["receipts"],
        ),

        confirm: protect(
            user => user?.access?.leads?.canConfirmPurchaseLeads,
            async ({ids}, {login}) => {
                ids = [].concat(ids).map(id => monkid(id));
                await db.update(
                    {_id: {$in: ids}},
                    {$set: {
                        confirmDate: dayjs().toDate(),
                        updated_at: dayjs().toDate(),
                    }},
                    {multi: true}
                )
                endpoints.logs.add({
                    receipt: ids,
                    type: "receipt",
                    event: "confirm",
                    author: login,
                });
            }
        ),

        changePosition: protect(
            user => user?.access?.leads?.canEditPurchases, //edit
            async ({_id, destSort}, {login}) => {
                const receipt = await changePosition({
                    _id,
                    destSort,
                    db,
                    parentKeyName: "lead",
                    limitation,
                });

                endpoints.logs.add({
                    receipt: _id,
                    type: "receipt",
                    event: "changePosition",
                    author: login,
                });

                return receipt;
            },
            ["receipts"],
        ),

        add: protect(
            user => user?.access?.leads?.canAddPurchases, //add
            async ({lead, ...receipt}, {login}) => {
                const sort = await db.count({lead: monkid(lead), ...limitation});

                const p = await db.insert({
                    status: "selection",
                    ...receipt,
                    lead: monkid(lead),
                    sort,
                    created_at: dayjs().toDate(),
                    updated_at: dayjs().toDate(),
                });

                endpoints.logs.add({
                    receipt: p._id,
                    type: "receipt",
                    event: "add",
                    author: login,
                });
            },
            ["receipts"],
        ),

        delete: protect(
            user => user?.access?.leads?.canDeletePurchases, //delete
            async ({ids}, {login}) => {
                const items = await deleteWithPosition({
                    ids,
                    db,
                    parentKeyName: "lead",
                    limitation,
                });

                endpoints.logs.add({
                    receipts: ids,
                    type: "receipt",
                    event: "delete",
                    author: login,
                });

                return items;
            },
            ["receipts"],
        ),
        clients: protect(
            user => user?.access?.leads?.canSeeLeads,
            async ({month}) => {
                const start = dayjs(month).startOf("month");
                const end = dayjs(month).endOf("month");
                const limitedTimeQuery = buildQuery([
                    {
                        condition: dayjs(month).year() !== dayjs().year() || dayjs(month).month() !== dayjs().month(),
                        query: {
                            depositDate: {
                                $gte: start.toDate(),
                                $lte: end.toDate(),
                            }
                        },
                    },
                    {
                        condition: dayjs(month).year() === dayjs().year() && dayjs(month).month() === dayjs().month(),
                        query: {
                            $or : [
                                {depositDate: {$gte: start.toDate(), $lte: end.toDate()}},
                                {depositDate: {$exists: false}},
                            ]
                        },
                    },
                ]);
                return await db.aggregate([
                    {
                        $match: {
                            ...limitedTimeQuery,
                            ...limitation,
                        },
                    },
                    {
                        $lookup: {
                            from: "new_purchases",
                            localField: "_id",
                            foreignField: "receipt",
                            as: "purchases",
                        },
                    },
                    {
                        $lookup: {
                            from: "suppliers",
                            localField: "supplier",
                            foreignField: "_id",
                            as: "supplier",
                        },
                    },
                    {
                        $set: {
                            purchasesCount: {
                                $size: {
                                    $filter: {
                                        input: "$purchases",
                                        as: "p",
                                        cond: {
                                            $or: [
                                                {$eq: [{$type: "$$p.deleted_at"}, "missing"]},
                                                {$eq: ["$$p.deleted_at", null]},
                                            ],
                                        },
                                    },
                                },
                            },
                        },
                    },
                    {
                        $project: {
                            purchases: 0,
                        },
                    },
                    {$sort: {sort: 1}},
                ]);
            }
        )
    },
    {
        db,
    },
);
