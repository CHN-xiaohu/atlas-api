import {buildQuery, escapedRegExp, itemIdToNumber, numberToItemId} from "../helper";
import {endpoint, protect} from "../lib/api-helper";
import {mongo, id as monkid} from "../lib/db";
import {endpoints} from "../lib/endpoints";
import {imagesOperator} from "../lib/qiniuyun";

import dayjs from "dayjs";
import {assoc, dissoc} from "ramda";

const productsWithOptionsAggregate = [
    {
        $lookup: {
            from: "product_options",
            localField: "_id",
            foreignField: "productId",
            as: "options",
        },
    },
    {
        $addFields: {
            options: {
                $filter: {
                    input: "$options",
                    as: "item",
                    cond: {
                        $eq: [{$type: "$$item.deleted_at"}, "missing"],
                    },
                },
            },
        },
    },
];

const productsSearchQuery = search => {
    if (typeof search !== "string" || search.length === 0) {
        return {};
    }
    const searchRegex = escapedRegExp(search.replace("#", ""), "i");
    const number = parseInt(search);
    return {
        $or: [
            {name: {$regex: searchRegex}},
            {englishName: {$regex: searchRegex}},
            {tags: {$regex: searchRegex}},
            {description: {$regex: searchRegex}},
            // {price: {$regex: searchRegex}},
            !isNaN(number) ? {price: number} : {},
            {brand: {$regex: searchRegex}},
            {set: {$regex: searchRegex}},
            {factoryTag: {$regex: searchRegex}},
            {itemId: searchRegex},
            //{$where: `this._id.str.match(/^${id}/)`},

            {"options.properties.name": {$regex: searchRegex}},
            {"options.properties.englishName": {$regex: searchRegex}},
            {"options.properties.tags": {$regex: searchRegex}},
            {"options.properties.description": {$regex: searchRegex}},
            {"options.properties.price": {$regex: searchRegex}},
            {"options.properties.brand": {$regex: searchRegex}},
            {"options.properties.set": {$regex: searchRegex}},
            {"options.properties.factoryTag": {$regex: searchRegex}},
            {"options.properties.itemId": searchRegex},
        ],
    };
};

const defaults = {
    skip: 0,
    limit: 0,
    projection: {},
    sort: {
        _id: -1,
    },
};

const sortObjectKey = (sortedKeys, object) => {
    const {sortedObject, unsortedObject} = sortedKeys.reduce(
        (acc, key) => {
            const {sortedObject, unsortedObject} = acc;
            const val = object[key];

            return val == null
                ? acc
                : {
                      sortedObject: assoc(key, val, sortedObject),
                      unsortedObject: dissoc(key, unsortedObject),
                  };
        },
        {sortedObject: {}, unsortedObject: object},
    );

    return {
        ...sortedObject,
        ...unsortedObject,
    };
};

const transformToAggregateOptions = options => {
    const dict = {
        skip: "$skip",
        limit: "$limit",
        projection: "$project",
        sort: "$sort",
    };

    return Object.keys(sortObjectKey(["projection", "sort", "skip", "limit"], options))
        .map(key => {
            const val = options[key];
            if (key === "projection" && (Object.keys(val).length === 0 || val == null)) return null;
            if (key === "skip" && (val === 0 || val == null)) return null;
            if (key === "limit" && (val === 0 || val == null)) return null;
            return {
                [dict[key]]: val,
            };
        })
        .filter(item => item != null);
};

const limitation = {
    deleted_at: {$exists: false},
};

const db = mongo.get("products");
const productOptionsDb = mongo.get("product_options");
const suppliersDb = mongo.get("suppliers");
const imagesDb = mongo.get("images");

const generateFiltersQuery = ({
    category,
    price,
    brands,
    materials,
    styles,
    room,
    search,
    productIds = null,
    supplier,
    manager,
    range,
    verification,
}) => {
    const generate = isOption => {
        const key = isOption ? key => `options.properties.${key}` : key => key;

        return buildQuery([
            {
                condition: category != null,
                query: {
                    [key("category")]: {$elemMatch: {$eq: category}},
                },
            },
            {
                condition: price != null,
                query: {
                    [key("price")]: {
                        $gte: price?.min ?? 0,
                        $lte: price?.max ?? 100000023402340,
                    },
                },
            },
            {
                condition: Array.isArray(brands) && brands.length > 0,
                query: {
                    [key("brand")]: {$in: brands},
                },
            },
            {
                condition: Array.isArray(materials) && materials.length > 0,
                query: {
                    [key("materials")]: {$elemMatch: {$in: materials}},
                },
            },
            {
                condition: Array.isArray(styles) && styles.length > 0,
                query: {
                    [key("styles")]: {$elemMatch: {$in: styles}},
                },
            },
            {
                condition: room != null,
                query: {
                    [key("rooms")]: room,
                },
            },
            {
                condition: supplier != null,
                query: {
                    [key("supplier")]: Array.isArray(supplier) ? {$in: supplier.map(s => monkid(s))} : monkid(supplier),
                },
            },
            {
                condition: typeof manager === "string" && manager.length > 0,
                query: {
                    created_by: manager,
                },
            },
            {
                condition: Array.isArray(range) && range.length === 2,
                query: {
                    [key("created_at")]: {
                        $gte: dayjs(range && range[0]).toDate(),
                        $lte: dayjs(range && range[1]).toDate(),
                    },
                },
            },
            {
                condition: verification != null,
                query:
                    verification === "verified"
                        ? {
                              [key("verified")]: true,
                          }
                        : verification === "declined"
                        ? {[key("declined")]: true}
                        : {
                              [key("verified")]: {$ne: true},
                              [key("declined")]: {$ne: true},
                          },
            },
        ]);
    };

    const extra = buildQuery([
        {
            query: productsSearchQuery(search),
        },
        ...(productIds == null
            ? [{}]
            : [
                  {
                      query: {
                          _id: {$in: productIds.map(_id => monkid(_id))},
                      },
                  },
              ]),
    ]);

    return {
        $and: [
            {
                $or: [generate(true), generate(false)],
            },
            ...(Object.keys(extra).length > 0 ? [extra] : []),
        ],
    };
};

const supplierStatusQueryMap = {
    like: {$eq: "like"},
    average: {$in: ["like", "average"]},
};

const getProductIdsBySearchImage = async imageUri => {
    if (imageUri == null) return null;

    const {data} = await imagesOperator.searchImage(
        imageUri.replace(/^data:(.*?)base64,/i, "data:application/octet-stream;base64,"),
        48,
        0.6,
    );

    return (data.result ?? []).map(item => item.product);
};

const get = async ({
    category,
    price,
    brands,
    materials,
    styles,
    room,
    search,
    imageUri = null,
    supplier,
    manager,
    range,
    verification,
    supplierStatus = "all",
    skip = defaults.skip,
    limit = defaults.limit,
    projection = defaults.projection,
    sort = defaults.sort,
}) => {
    const params = {skip, limit, projection, sort};
    const suppliers = await (supplier != null
        ? suppliersDb.find({
              _id: Array.isArray(supplier) ? {$in: supplier.map(s => monkid(s))} : monkid(supplier),
          })
        : suppliersDb.find({status: supplierStatusQueryMap[supplierStatus] ?? {$ne: "blacklisted"}}));

    const productIds = await getProductIdsBySearchImage(imageUri);

    const query = generateFiltersQuery({
        category,
        price,
        brands,
        materials,
        styles,
        room,
        search,
        productIds,
        supplier: suppliers.map(supplier => supplier._id),
        manager,
        range,
        verification,
    });

    const products = await db.aggregate([
        ...productsWithOptionsAggregate,
        {
            $match: {
                ...query,
                ...limitation,
            },
        },
        {
            $project: {
                options: 0,
            },
        },
        ...transformToAggregateOptions({...defaults, ...params}),
    ]);

    return products.map(product => ({
        ...product,
        supplierStatus: suppliers.find(supplier => supplier._id.toString() === product.supplier.toString())?.status,
    }));
};

const add = async ({supplier, ...product}, {login}) => {
    const mongoId = monkid();
    const lastItem = await db.findOne({}, {sort: {_id: -1}});
    const lastIndex = itemIdToNumber(lastItem.itemId);
    const inserted = await db.insert({
        ...product,
        _id: mongoId,
        itemId: numberToItemId(lastIndex + 1),
        supplier: monkid(supplier),
        created_at: dayjs().toDate(),
        created_by: login,
    });

    if (inserted.photos != null && inserted.photos.length > 1) {
        const images = await imagesDb.find({_id: {$in: inserted.photos}}, {projection: {_id: 1, originalKey: 1}});
        const preparedImages = images.map(image => {
            const productId = inserted._id.toString();
            const imageId = image._id.toString();

            return {
                uri: imagesOperator.getFileLink(image.originalKey) + "|original",
                attribute: {
                    id: `${productId}|${imageId}`,
                    label: inserted.name,
                    desc: {product: productId, image: imageId},
                },
            };
        });
        await imagesOperator.addImagesToLibrary(preparedImages);
    }

    endpoints.logs.add({
        type: "product",
        event: "add",
        id: monkid(inserted._id),
        supplier: monkid(supplier),
        author: login,
    });
    return inserted._id;
};

export const products = endpoint(
    {
        countImages: protect(
            user => user?.access?.products?.canSeeProducts, //see
            async () => {
                const products = await db.find(
                    {...limitation},
                    {
                        projection: {
                            photos: 1,
                        },
                    },
                );
                return products.reduce((acc, product) => {
                    if (Array.isArray(product.photos)) {
                        return acc + product.photos.length;
                    }
                    return acc;
                }, 0);
            },
        ),

        count: protect(
            user => user?.access?.products?.canSeeProducts, //see
            async ({
                category,
                price,
                brands,
                materials,
                styles,
                room,
                search,
                imageUri = null,
                supplier,
                manager,
                range,
                verification,
                supplierStatus = "all",
            }) => {
                const suppliers = await (supplier != null
                    ? suppliersDb.find({
                          _id: Array.isArray(supplier) ? {$in: supplier.map(s => monkid(s))} : monkid(supplier),
                      })
                    : suppliersDb.find({status: supplierStatusQueryMap[supplierStatus] ?? {$ne: "blacklisted"}}));

                const productIds = await getProductIdsBySearchImage(imageUri);

                const query = generateFiltersQuery({
                    category,
                    price,
                    brands,
                    materials,
                    styles,
                    room,
                    search,
                    productIds,
                    supplier: suppliers.map(supplier => supplier._id),
                    manager,
                    range,
                    verification,
                });

                const result = await db.aggregate([
                    ...productsWithOptionsAggregate,
                    {
                        $match: {
                            ...query,
                            ...limitation,
                        },
                    },
                    {
                        $count: "count",
                    },
                ]);

                return result?.[0]?.count ?? 0;
            },
        ),

        get: protect(
            user => user?.access?.products?.canSeeProducts, //see
            get,
        ),

        byId: protect(
            user => user?.access?.products?.canSeeProducts, //see
            async ({_id, ...params}) => {
                return db.findOne({_id: monkid(_id), ...limitation}, {...defaults, ...params});
            },
        ),

        list: protect(
            user => user?.access?.products?.canSeeProducts, //see
            async ({ids, ...params}) => {
                if (!Array.isArray(ids) || ids.length === 0) {
                    //console.log('invalid', ids)
                    return [];
                }
                return db.find({_id: {$in: ids.map(id => monkid(id))}, ...limitation}, {...defaults, ...params});
            },
        ),

        getNext: protect(
            user => user?.access?.products?.canSeeProducts, //see
            async ({
                current,
                reverse,
                category,
                price,
                brands,
                materials,
                styles,
                search,
                supplier,
                manager,
                range,
                verification,
                ...params
            }) => {
                const query = generateFiltersQuery({
                    category,
                    price,
                    brands,
                    materials,
                    styles,
                    search,
                    supplier,
                    manager,
                    range,
                    verification,
                });
                const filter = !reverse ? "$lt" : "$gt";

                const result = await db.aggregate([
                    ...productsWithOptionsAggregate,
                    {
                        $match: {
                            ...query,
                            _id: {[filter]: monkid(current)},
                            ...limitation,
                        },
                    },
                    {
                        $project: {
                            options: 0,
                        },
                    },
                    ...transformToAggregateOptions({sort: {_id: -1, limit: 1}, ...params}),
                ]);

                return result?.[0];
            },
        ),

        bySet: protect(
            user => user?.access?.products?.canSeeProducts, //see
            async ({set, ...params}) => {
                if (typeof set !== "string" || set.length === 0) {
                    return [];
                }
                return db.find({set}, {...defaults, ...params});
            },
        ),

        add: protect(
            user => user?.access?.products?.canAddProducts, //add
            add,
            ["products"],
        ),

        change: protect(
            user => user?.access?.products?.canEditProducts, //edit
            async ({_id, key, value}, {login}) => {
                const oldProduct = await db.findOne({_id});
                const updated = await db.findOneAndUpdate(
                    {_id},
                    {
                        $set: {
                            [key]: value,
                            updated_at: dayjs().toDate(),
                            verified: null,
                            declined: null,
                        },
                    },
                );
                endpoints.logs.add({
                    type: "product",
                    event: "change",
                    id: monkid(_id),
                    key,
                    oldValue: oldProduct[key],
                    value,
                    supplier: monkid(updated.supplier),
                    author: login,
                });
            },
            ["products"],
        ),

        delete: protect(
            user => user?.access?.products?.canDeleteProducts, //delete
            async ({_id}, {login}) => {
                const s = await db.findOneAndUpdate({_id}, {$set: {deleted_at: dayjs().toDate()}});
                endpoints.logs.add({
                    type: "product",
                    event: "delete",
                    name: s.name,
                    id: monkid(_id),
                    author: login,
                });
            },
            ["products"],
        ),

        verify: protect(
            user => user?.access?.products?.canVerifyProducts, //verify
            async ({_id}, {login}) => {
                const s = await db.findOneAndUpdate({_id}, {$set: {verified: true}});
                endpoints.logs.add({
                    type: "product",
                    event: "verify",
                    name: s.name,
                    id: monkid(_id),
                    author: login,
                });
            },
            ["products"],
        ),

        cancelVerification: protect(
            user => user?.access?.products?.canVerifyProducts,
            async ({_id}, {login}) => {
                const s = await db.findOneAndUpdate({_id}, {$set: {declined: null, verified: null}});
                endpoints.logs.add({
                    type: "product",
                    event: "cancelVerification",
                    name: s.name,
                    id: monkid(_id),
                    author: login,
                });
            },
            ["products"],
        ),

        decline: protect(
            user => user?.access?.products?.canVerifyProducts, //verify
            async ({_id}, {login}) => {
                const s = await db.findOneAndUpdate({_id}, {$set: {declined: true}});
                endpoints.logs.add({
                    type: "product",
                    event: "decline",
                    name: s.name,
                    id: monkid(_id),
                    author: login,
                });
            },
            ["products"],
        ),

        addWithOptions: protect(
            user => user?.access?.products?.canAddProducts, //add
            async ({product, options}, {login}) => {
                const productId = await add(product, {login});
                const preparedOptions = options.map(option => assoc("productId", productId, option));
                const insertedOptions = await productOptionsDb.insert(preparedOptions);
                const optionIds = insertedOptions.map(option => option._id);

                endpoints.logs.add({
                    type: "product",
                    event: "addWithOptions",
                    ids: monkid(optionIds),
                    productId: productId,
                    author: login,
                });

                return {productId, optionIds};
            },
        ),
        supplierStats: protect(
            user => user?.access?.products?.canSeeProducts,
            async ({...filters}) => {
                const query = Object.keys(filters).reduce((res, key) => {
                    if (key === "supplier") {
                        res[key] = monkid(filters[key]);
                    } else {
                        res[key] = filters[key];
                    }
                    return res;
                }, {});
                const total = await db.count({...query, deleted_at: {$exists: false}});
                const stats = await db.aggregate([
                    {
                        $match: {...query, deleted_at: {$exists: false}},
                    },
                    {
                        $group: {
                            _id: {$arrayElemAt: ["$category", 1]},
                            count: {$sum: 1},
                        },
                    },
                ]);
                return {
                    ...stats.reduce((res, entry) => {
                        res[entry._id] = entry.count;
                        return res;
                    }, {}),
                    total,
                };
            },
        ),
    },
    {
        db,
        limitation,
        get,
    },
);
