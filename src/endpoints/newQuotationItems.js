import {endpoint, protect, client} from "../lib/api-helper";
import {mongo, id as monkid} from "../lib/db";
import {endpoints} from "../lib/endpoints";

import dayjs from "dayjs";
import {advancedResponse} from "../lib/api-helper";
import {buildQuery, idRegex} from "../helper";
import {changePosition, deleteWithPosition, leadName} from "../helper";
import {finalPrice as calcFinalPrice} from "./newQuotations";

const LANGUAGE_RU = "ru";
const LANGUAGE_EN = "en";
//const LANGUAGE_ZH = "zh";

const limitation = {
    deleted_at: {$eq: null},
};

const db = mongo.get("new_quotation_items");
const quotationsDb = mongo.get("new_quotations");
const dictionariesDb = mongo.get("dictionaries");

const countQuotationItems = quotationId => {
    return db.count({quotation: monkid(quotationId), ...limitation});
};

const log = ({key = "id", val, event, login}) => {
    const author = login || "system";

    endpoints.logs.add({
        [key]: val,
        type: "quotation_item",
        event: event,
        author,
    });
};

const translate = (dictionary, language, key) => {
    const word = dictionary.words.find(word => word.key === key);
    return word?.[language] ?? word?.[LANGUAGE_EN] ?? key;
};

const translateForArray = (dictionary, language, keys) => {
    return keys.map(key => translate(dictionary, language, key));
};

const getDictionary = dictionaryName => {
    return dictionariesDb.findOne({name: dictionaryName});
};

const createQuotationItemDataAboutProduct = async (product, quotation) => {
    const labelDictionary = {
        [LANGUAGE_EN]: {
            Size: "Size",
            Materials: "Materials",
            Brand: "Brand",
            Styles: "Styles",
        },

        [LANGUAGE_RU]: {
            Size: "Размер",
            Materials: "Материалы",
            Brand: "Бренд",
            Styles: "Стиль",
        },
    };

    const supplier = await endpoints.suppliers.db.findOne({_id: monkid(product.supplier)});

    const materialDictionary = await getDictionary("materials");
    const brandDictionary = await getDictionary("brands");
    const styleDictionary = await getDictionary("styles");

    const language = quotation.language;

    const labelWords = labelDictionary[language];

    const size = product.size == null ? "" : `${labelWords["Size"]}: ${product.size}\n`;

    const materials =
        (product.materials ?? []).length <= 0
            ? ""
            : `${labelWords["Materials"]}: ${translateForArray(
                  materialDictionary,
                  language,
                  product.materials ?? [],
              )}\n`;

    const brand =
        product.brand == null ? "" : `${labelWords["Brand"]}: ${translate(brandDictionary, language, product.brand)}\n`;

    const styles =
        (product.styles ?? []).length <= 0
            ? ""
            : `${labelWords["Styles"]}: ${translateForArray(styleDictionary, language, product.styles ?? [])}\n`;

    const characteristics = size + materials + brand + styles;

    return {
        photos: product.photos,
        price: product.price,
        characteristics,
        description: product.description,
        interest: product.interest ?? supplier?.interest ?? quotation[product.category?.[0]] ?? 0.3,
        supplier: product.supplier == null ? product.supplier : monkid(product.supplier),
        shipping: product.shipping ?? supplier?.shipping ?? 0,
    };
};

export const newQuotationItems = endpoint(
    {
        forQuotations: protect(
            user => user?.access?.products?.canSeeQuotations, // see
            async ({quotationIds, leadId, approveStatus, readStatus}, {login}) => {
                const query = buildQuery([
                    {
                        condition: approveStatus === "approved",
                        query: {approved: true},
                    },
                    {
                        condition: approveStatus === "declined",
                        query: {declined: true},
                    },
                    {
                        condition: readStatus === "read",
                        query: {
                            _id: {
                                $in: Object.entries(
                                    await endpoints.comments.unreadMultiple({quotationIds, leadId}, {login}),
                                ).reduce((tail, entry) => {
                                    const [key, value] = entry;
                                    if (value === 0) {
                                        return [...tail, key];
                                    } else {
                                        return tail;
                                    }
                                }, []),
                            },
                        },
                    },
                    {
                        condition: readStatus === "unread",
                        query: {
                            _id: {
                                $in: Object.entries(
                                    await endpoints.comments.unreadMultiple({quotationIds, leadId}, {login}),
                                ).reduce((tail, entry) => {
                                    const [key, value] = entry;
                                    if (value !== 0) {
                                        return [...tail, key];
                                    } else {
                                        return tail;
                                    }
                                }, []),
                            },
                        },
                    },
                ]);
                const quotationItems = await db.find(
                    {
                        quotation: {
                            $in: quotationIds.map(id => monkid(id)),
                        },
                        ...query,
                        ...limitation,
                    },
                    {
                        sort: {
                            sort: 1,
                        },
                    },
                );

                return quotationItems;
            },
        ),

        byId: protect(
            user => user?.access?.products?.canSeeQuotations, //see
            async ({_id}) => {
                return db.findOne({_id, ...limitation});
            },
        ),

        update: protect(
            user => user?.access?.products?.canEditQuotations, // edit
            async ({_id, key, val}, {login}) => {
                const quotationItem = await db.findOneAndUpdate(
                    {_id, ...limitation},
                    {
                        $set: {
                            [key]: val,
                            updated_at: dayjs().toDate(),
                        },
                    },
                );

                if (quotationItem == null) return null;

                log({
                    val: quotationItem._id,
                    event: "update",
                    login,
                });

                return quotationItem;
            },
            ["newQuotationItems"],
        ),

        add: protect(
            user => user?.access?.products?.canEditQuotations, // add
            async ({productIdOrProductOptionId, quotationId}, {login}) => {
                // 判断是否已经添加过
                const quotationItemWithThisProduct = await db.findOne({
                    quotation: monkid(quotationId),
                    product: monkid(productIdOrProductOptionId),
                    ...limitation,
                });

                if (quotationItemWithThisProduct != null) return null;

                const {option, product} = await endpoints.productOptions.getOptionAndProduct(productIdOrProductOptionId);
                const mergedProduct = endpoints.productOptions.mergeOptionIntoProductByData(product, option);
                const quotation = await quotationsDb.findOne({_id: quotationId, ...limitation});

                if (mergedProduct == null || quotation == null) return null;

                const sort = await countQuotationItems(quotationId);
                const quotationItemData = await createQuotationItemDataAboutProduct(mergedProduct, quotation);

                const quotationItem = await db.insert({
                    product: monkid(product._id),
                    optionId: option._id == null ? null : monkid(option._id),
                    quotation: monkid(quotationId),
                    name: quotation.language === LANGUAGE_EN ? mergedProduct.englishName : mergedProduct.name,
                    sort,
                    ...quotationItemData,
                    created_by: login,
                    quantity: 1,
                    created_at: dayjs().toDate(),
                    updated_at: dayjs().toDate(),
                    deleted_at: null,
                    itemId: mergedProduct.itemId,
                });

                log({
                    val: quotationItem._id,
                    event: "add",
                    login,
                });

                return quotationItem;
            },
            ["newQuotationItems"],
        ),

        addCustomization: protect(
            user => user?.access?.products?.canEditQuotations, // add
            async ({quotationId, ...props}, {login}) => {
                const sort = await countQuotationItems(quotationId);
                return db.insert({
                    quantity: 1,
                    ...props,
                    quotation: monkid(quotationId),
                    sort,
                    created_by: login,
                    created_at: dayjs().toDate(),
                    updated_at: dayjs().toDate(),
                });
            },
            ["newQuotationItems"],
        ),

        delete: protect(
            user => user?.access?.products?.canEditQuotations, // delete
            async ({ids}, {login}) => {
                const items = await deleteWithPosition({
                    ids,
                    db,
                    parentKeyName: "quotation",
                    limitation,
                });

                log({
                    key: "ids",
                    val: ids,
                    event: "delete",
                    login,
                });

                return items;
            },
            ["newQuotationItems"],
        ),

        changePosition: protect(
            user => user?.access?.products?.canEditQuotations, // edit
            async ({_id, destSort}, {login}) => {
                const quotationItem = await changePosition({
                    _id,
                    destSort,
                    db,
                    parentKeyName: "quotation",
                    limitation,
                });

                log({
                    val: quotationItem._id,
                    event: "updateSort",
                    login,
                });

                return quotationItem;
            },
            ["newQuotationItems"],
        ),

        refresh: protect(
            user => user?.access?.products?.canEditQuotations, // edit
            async ({_id}, {login}) => {
                const quotationItem = await db.findOne({_id});
                const quotation = await quotationsDb.findOne({_id: quotationItem.quotation});
                const product = await endpoints.productOptions.mergeOptionIntoProductById(quotationItem.product)
                const quotationItemData = await createQuotationItemDataAboutProduct(product, quotation);
                const result = await db.findOneAndUpdate({_id}, {$set: quotationItemData});

                log({
                    val: result._id,
                    event: "refresh",
                    login,
                });

                return result;
            },
            ["newQuotationItems"],
        ),

        quotationItemsForClient: client(
            lead => lead != null,
            async ({quotationId}) => {
                if (!idRegex.test(quotationId)) {
                    return advancedResponse(404, {error: "Quotation id is not valid"});
                }

                const quotationItems = await db.find(
                    {quotation: monkid(quotationId), ...limitation},
                    {
                        sort: {sort: 1},
                        projection: {
                            _id: 1,
                            characteristics: 1,
                            photos: 1,
                            price: 1,
                            name: 1,
                            approved: 1,
                            declined: 1,
                            interest: 1,
                            sort: 1,
                            itemId: 1,
                            quantity: 1,
                        },
                    },
                );

                return quotationItems.map(item => {
                    const price = calcFinalPrice(item.price, item.interest ?? 0.3, item.shipping ?? 0);
                    const {interest, ...returnedItem} = item;

                    return {
                        ...returnedItem,
                        price,
                    };
                });
            },
        ),

        approve: client(
            lead => lead != null,
            async ({_id, contactId}, lead) => {
                const {responsible, contacts} = lead;
                const item = await db.findOneAndUpdate(
                    {_id},
                    {
                        $set: {
                            approved: true,
                            approved_by: monkid(contactId),
                            declined: false,
                            updated_at: dayjs().toDate(),
                        },
                        $unset: {
                            declined_by: "",
                        },
                    },
                );
                const quotation = await quotationsDb.findOne({_id: monkid(item.quotation)});
                const contact = contacts.find(c => c._id.toString() === contactId);
                endpoints.notifications.sendNotification({
                    description: `[<a href="https://atlas.globus.furniture/leads/${lead._id}">${leadName(lead)}</a>] ${
                        contact?.contact_name ?? "client"
                    } approved <a href="https://atlas.globus.furniture/leads/${lead._id}/new_quotations/${
                        item.quotation
                    }/${_id}">${item.name}</a>`,
                    receivers: quotation.responsibles.length === 0 ? [responsible] : quotation.responsibles,
                });
            },
            ["newQuotationItems"],
        ),

        decline: client(
            lead => lead != null,
            async ({_id, contactId}, lead) => {
                const {responsible, contacts} = lead;
                const item = await db.findOneAndUpdate(
                    {_id},
                    {
                        $set: {
                            declined: true,
                            declined_by: monkid(contactId),
                            approved: false,
                            updated_at: dayjs().toDate(),
                        },
                        $unset: {
                            approved_by: "",
                        },
                    },
                );
                const quotation = await quotationsDb.findOne({_id: monkid(item.quotation)});
                const contact = contacts.find(c => c._id.toString() === contactId);
                endpoints.notifications.sendNotification({
                    description: `[<a href="https://atlas.globus.furniture/leads/${lead._id}">${leadName(lead)}</a>] ${
                        contact?.contact_name ?? "client"
                    } declined <a href="https://atlas.globus.furniture/leads/${lead._id}/new_quotations/${
                        item.quotation
                    }/${_id}">${item.name}</a>`,
                    receivers: quotation.responsibles.length === 0 ? [responsible] : quotation.responsibles,
                });
            },
            ["newQuotationItems"],
        ),

        resetItem: client(
            lead => lead != null,
            async ({_id, contactId}, lead) => {
                const {responsible, contacts} = lead;
                const item = await db.findOneAndUpdate(
                    {_id},
                    {
                        $set: {
                            approved: false,
                            declined: false,
                            updated_at: dayjs().toDate(),
                        },
                        $unset: {
                            approved_by: "",
                            declined_by: "",
                        },
                    },
                );
                const quotation = await quotationsDb.findOne({_id: monkid(item.quotation)});
                const contact = contacts.find(c => c._id.toString() === contactId);
                endpoints.notifications.sendNotification({
                    description: `[<a href="https://atlas.globus.furniture/leads/${lead._id}">${leadName(lead)}</a>] ${
                        contact?.contact_name ?? "client"
                    } changed his/her mind about <a href="https://atlas.globus.furniture/leads/${
                        lead._id
                    }/new_quotations/${item.quotation}/${_id}">${item.name}</a>`,
                    receivers: quotation.responsibles.length === 0 ? [responsible] : quotation.responsibles,
                });
            },
            ["newQuotationItems"],
        ),

        moveToAnotherQuotation: protect(
            user => user?.access?.products?.canEditQuotations, // edit
            async ({_id, quotationId}, {login}) => {
                const quotationItem = await db.findOne({_id, ...limitation});
                if (quotationItem == null) return null;

                await db.update(
                    {quotation: monkid(quotationItem.quotation), sort: {$gt: quotationItem.sort}, ...limitation},
                    {$inc: {sort: -1}},
                    {multi: true},
                );

                const sort = await countQuotationItems(quotationId);

                const movedQuotationItem = await db.findOneAndUpdate(
                    {_id},
                    {
                        $set: {
                            quotation: monkid(quotationId),
                            sort,
                            updated_at: dayjs().toDate(),
                        },
                    },
                );

                log({
                    val: _id,
                    event: "moveToAnotherQuotation",
                    login,
                });

                return movedQuotationItem;
            },
        ),

        copy: protect(
            user => user?.access?.products?.canEditQuotations, // edit
            async ({_id, quotationId}, {login}) => {
                const quotationItem = await db.findOne({_id, ...limitation});
                if (quotationItem == null) return null;
                const sort = await countQuotationItems(quotationId);

                const {_id: _deletedId, ...preparedQuotationItem} = {
                    ...quotationItem,
                    quotation: monkid(quotationId),
                    sort,
                    created_by: login,
                    created_at: dayjs().toDate(),
                    updated_at: dayjs().toDate(),
                    deleted_at: null,
                };

                const insertedQuotationItem = await db.insert(preparedQuotationItem);

                log({
                    val: insertedQuotationItem._id,
                    event: "copy",
                    login,
                });

                return insertedQuotationItem;
            },
            ["newQuotationItems"],
        ),
    },
    {
        db,
        limitation,
    },
);
