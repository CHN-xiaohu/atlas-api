import {endpoint, protect} from "../lib/api-helper";
import {id as monkid, mongo} from "../lib/db";
import {endpoints} from "../lib/endpoints";
import dayjs from "dayjs";
import isBetween from "dayjs/plugin/isBetween";
import objectHash from "object-hash";

dayjs.extend(isBetween);

const defaults = {
    skip: 0,
    limit: 0,
    projection: {},
};

const limitation = {
    deleted_at: {$eq: null},
};

const filterReceiptsForSuppliers = (receipts, supplier, start, end) =>
    receipts
        .filter(
            receipt =>
                receipt.supplier?.toString() === supplier._id.toString() &&
                dayjs(receipt.created_at).isBetween(start, end),
        )
        .reduce(
            ({sumForClient, interest}, receipt) => ({
                sumForClient: sumForClient + receipt.sumForClient ?? 0,
                interest: interest + receipt.interest ?? 0,
            }),
            {sumForClient: 0, interest: 0},
        );

const db = mongo.get("suppliers");

const filtersAreEmpty = filters =>
    Object.keys(filters).find(filter => {
        return (
            filters[filter] &&
            (Array.isArray(filters[filter]) || typeof filters[filter] === "string") &&
            filters[filter].length > 0
        );
    }) == null;

const suppliersAdditionalInformationCache = {};

export const suppliers = endpoint(
    {
        byId: protect(
            user => user?.access?.products?.canSeeSuppliers && user?.access?.products?.canSeeSupplierInformation, //see
            async ({_id, ...params}) => {
                return db.findOne({_id, ...limitation}, {...defaults, ...params});
            },
        ),

        byIds: protect(
            user => user?.access?.products?.canSeeSuppliers, //see
            async ({ids, ...params}) => {
                if (!Array.isArray(ids) || ids.length === 0) {
                    return [];
                }
                return db.find({_id: {$in: ids.map(id => monkid(id))}, ...limitation}, {...defaults, ...params});
            },
        ),

        count: protect(
            user => user?.access?.products?.canSeeSuppliers, //see
            async () => {
                return db.count({...limitation});
            },
        ),

        get: protect(
            user => user?.access?.products?.canSeeSuppliers, //see
            async (
                {
                    skip = defaults.skip,
                    limit = defaults.limit,
                    sort = defaults.sort,
                    projection = defaults.projection,
                    ...filters
                },
                _user,
            ) => {
                const queryHash = objectHash(filters);
                if (!Object.prototype.hasOwnProperty.call(suppliersAdditionalInformationCache, queryHash)) {
                    suppliersAdditionalInformationCache[queryHash] = {};
                }
                const curMonth = dayjs().endOf("month");
                const last3Month = dayjs().subtract(3, "month");
                const last6Month = dayjs().subtract(6, "month");
                const queryCache = suppliersAdditionalInformationCache[queryHash];
                const suppliers = await db.find({...limitation}, {skip, limit, sort, projection});
                const uncachedSuppliers = suppliers
                    .filter(supplier => !Object.prototype.hasOwnProperty.call(queryCache, supplier._id.toString()))
                    .map(supplier => supplier._id);
                if (uncachedSuppliers.length > 0) {
                    const products = await endpoints.products.get({
                        supplier: {$in: uncachedSuppliers},
                        ...filters,
                        ...limitation,
                        projection: {
                            styles: 1,
                            category: 1,
                            supplier: 1,
                        },
                    });
                    const receipts = await endpoints.receipts.db.find({
                        ...limitation,
                    });
                    suppliers
                        .map(supplier => {
                            const productsForThisSupplier = products.filter(
                                product => product.supplier.toString() === supplier._id.toString(),
                            );
                            return {
                                _id: supplier._id,
                                styles: [
                                    ...new Set(
                                        productsForThisSupplier
                                            .map(product => product.styles)
                                            .filter(styles => Array.isArray(styles) && styles.length > 0)
                                            .flat(),
                                    ),
                                ],
                                categories: [...new Set(productsForThisSupplier.map(product => product.category[1]))],
                                productCount: productsForThisSupplier.length,
                                "turnover0-3": filterReceiptsForSuppliers(receipts, supplier, last3Month, curMonth),
                                "turnover3-6": filterReceiptsForSuppliers(receipts, supplier, last6Month, last3Month),
                            };
                        })
                        .forEach(({_id, ...data}) => {
                            queryCache[_id] = data;
                        });
                }
                return suppliers
                    .map(supplier => {
                        return {
                            ...supplier,
                            ...queryCache[supplier._id],
                        };
                    })
                    .filter(supplier => {
                        return filtersAreEmpty(filters) || supplier.productCount > 0;
                    });
            },
        ),

        new: protect(
            user => user?.access?.products?.canAddSuppliers, //add
            async ({...supplier}, {login}) => {
                const inserted = await db.insert({...supplier, created_at: dayjs().toDate(), created_by: login});

                endpoints.logs.add({
                    type: "supplier",
                    event: "add",
                    id: monkid(inserted._id),
                    author: login,
                });
                return inserted;
            },
            ["suppliers"],
        ),

        addContact: protect(
            user => user?.access?.products?.canEditSuppliers,
            async ({supplierId, contact, type = "showrooms"}, {login}) => {
                const finalContact = {_id: monkid(), ...contact};
                const supplier = await db.findOneAndUpdate({_id: monkid(supplierId)}, {$push: {[type]: finalContact}});

                endpoints.logs.add({
                    id: supplier._id,
                    contactId: finalContact._id,
                    contact: finalContact,
                    type: "supplier",
                    event: `${type}.add`,
                    author: login || "system",
                });
            }
        ),

        deleteContact: protect(
            user => user?.access?.products?.canEditSuppliers, //edit
            async ({supplierId, contactId, type = "showrooms"}, {login}) => {
                const supplier = await db.findOne({
                    _id: monkid(supplierId),
                    [`${type}._id`]: monkid(contactId)
                });
                if (supplier == null) return null;

                const oldContact = supplier[type]?.find(contact => contact._id.toString() === contactId);
                const updatedContacts = supplier[type]?.filter(contact => contact._id.toString() !== contactId);

                await db.update(
                    {_id: supplier._id},
                    {$set: {[type]: updatedContacts}}
                );

                endpoints.logs.add({
                    id: supplier._id,
                    type: "supplier",
                    event: `${type}.delete`,
                    author: login || "system",
                    contactId,
                    contact: oldContact
                });

                return oldContact;
            },
            ["suppliers"]
        ),

        changeContact: protect(
            user => user?.access?.products?.canEditSuppliers, //edit
            async ({supplierId, contactId, type = "showrooms", key, val}, {login}) => {
                const oldSupplier = await db.findOne({
                    _id: monkid(supplierId),
                    [`${type}._id`]: monkid(contactId),
                }, {projection: {[`${type}.$`]: 1}});
                if (oldSupplier == null) return;
                const oldContact = oldSupplier[type][0];

                const newSupplier = await db.findOneAndUpdate({[`${type}._id`]: monkid(contactId)}, {$set: {[`${type}.$.${key}`]: val}});

                if (newSupplier == null) return null;

                const contact = newSupplier[type]?.find(contact => contact._id.toString() === contactId);

                endpoints.logs.add({
                    id: newSupplier._id,
                    type: "supplier",
                    event: `${type}.change`,
                    author: login || "system",
                    contactId,
                    contact,
                    attribute: key,
                    val,
                    oldVal: oldContact[key],
                });

                return contact;
            },
            ["suppliers"]
        ),

        change: protect(
            user => user?.access?.products?.canEditSuppliers, //edit
            async ({_id, key, value}, {login}) => {
                const updated = await db.findOneAndUpdate({_id}, {$set: {[key]: value, updated_at: dayjs().toDate()}});
                endpoints.logs.add({
                    type: "supplier",
                    event: "change",
                    key,
                    value,
                    id: monkid(_id),
                    author: login,
                });
                return updated;
            },
            ["suppliers"],
        ),

        delete: protect(
            user => user?.access?.products?.canDeleteSuppliers, //delete
            async ({_id}, {login: author}) => {
                const s = await db.findOneAndUpdate({_id}, {$set: {deleted_at: dayjs().toDate()}});
                endpoints.logs.add({
                    type: "supplier",
                    event: "delete",
                    id: monkid(_id),
                    author,
                });
                console.log("delete supplier", s);
            },
            ["suppliers"],
        ),
    },
    {
        db,
    },
);
