import dayjs from "dayjs";
import {endpoint, protect} from "../lib/api-helper";
import {mongo, id as monkid} from "../lib/db";
import {endpoints} from "../lib/endpoints";

const limitation = {
    deleted_at: {$eq: null},
};

const db = mongo.get("new_purchases");

export const purchases = endpoint(
    {
        forReceipts: protect(
            user => user?.access?.leads?.canSeePurchases, //leads see
            async ({ids}) => {
                if (ids == null || ids.length === 0) {
                    return null;
                }

                ids = ids.map(id => monkid(id));

                return db.find({
                    receipt: {
                        $in: ids,
                    },
                    ...limitation,
                });
            },
        ),

        update: protect(
            user => user?.access?.leads?.canEditPurchases, //edit
            async ({_id, receipt, lead, quotation, product, ...restProps}, {login}) => {
                const p = await db.findOneAndUpdate(
                    {_id},
                    {
                        $set: {
                            ...restProps,
                            receipt: monkid(receipt),
                            lead: lead != null && lead !== '' ? monkid(lead) : quotation,
                            quotation: quotation != null && quotation !== '' ? monkid(quotation) : quotation,
                            product: quotation != null && product !== false && product !== '' ? monkid(product) : product,
                            updated_at: dayjs().toDate(),
                        },
                    },
                );
                endpoints.logs.add({
                    purchase: p._id,
                    type: "purchase",
                    event: "change",
                    author: login,
                });

                return p;
            },
            ["purchases"],
        ),

        add: protect(
            user => user?.access?.leads?.canAddPurchases, //add
            async ({receipt, ...purchase}, {login}) => {
                const p = await db.insert({
                    receipt: monkid(receipt),
                    ...purchase,
                    created_at: dayjs().toDate(),
                    updated_at: dayjs().toDate(),
                });
                endpoints.logs.add({
                    purchase: p._id,
                    type: "purchase",
                    event: "add",
                    author: login,
                });
            },
            ["purchases"],
        ),

        delete: protect(
            user => user?.access?.leads?.canDeletePurchases, //delete
            async ({ids}, {login}) => {
                ids = ids.map(id => monkid(id));

                db.update({_id: {$in: ids}}, {$set: {deleted_at: dayjs().toDate()}}, {multi: true});

                endpoints.logs.add({
                    purchases: ids,
                    type: "purchase",
                    event: "delete",
                    author: login,
                });
            },
            ["purchases"],
        ),
        moveToAnotherReceipt: protect(
            user => user?.access?.leads?.canEditPurchases, // edit
            async ({ids = [], receiptId}, {login}) => {
                const records = await db.find({_id: {$in: [...ids]}});

                if (records?.length == null || records?.length === 0 || records.length !== ids.length) return null;

                const receipt = await endpoints.receipts.db.findOne({_id: monkid(receiptId)});
                if (receipt == null) return null;

                const movedReceiptItem = await db.update(
                    {_id: {$in: [...ids]}},
                    {$set: {
                        receipt: monkid(receiptId),
                        updated_at: dayjs().toDate(),
                    }},
                    {multi: true},
                );

                endpoints.logs.add({
                    purchases: ids,
                    receipt: receiptId,
                    type: "purchase",
                    event: "moveToAnotherReceipt",
                    author: login,
                });

                return movedReceiptItem;
            },
        ),
    },
    {
        db,
    },
);
