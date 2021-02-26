import {endpoints} from "../lib/endpoints";
import {endpoint, protect} from "../lib/api-helper";
import {mongo, id as monkid} from "../lib/db";
import dayjs from "dayjs";
import {assoc} from "ramda";

const db = mongo.get("product_options");
const productsDb = mongo.get("products");

const limitation = {
    deleted_at: {$eq: null},
};

const allByProductId = async (productId) => {
    return db.find({productId: monkid(productId), ...limitation});
};

const mergeOptionIntoProductById = async (productIdOrProductOptionId) => {
    const {option, product} = await getOptionAndProduct(productIdOrProductOptionId);
    return mergeOptionIntoProductByData(product, option);
}

const getOptionAndProduct = async (productIdOrProductOptionId) => {
    const option = await getOption(productIdOrProductOptionId);
    const productId = optionIsTemplate(option) ? productIdOrProductOptionId : option.productId;
    const product = await productsDb.findOne({_id: productId, ...endpoints.products.limitation})
    return {option, product};
};

const getOption = async (productIdOrProductOptionId) => {
    return (await db.findOne({_id: productIdOrProductOptionId, ...limitation})) ?? {properties: {}};
};

const mergeOptionIntoProductByData = (product, option) => {
    return Object.keys(option.properties).reduce((product, key) =>
        assoc(key, option.properties[key], product)
    , product)
};

const optionIsTemplate = (option) => {
    return option.productId == null;
}

export const productOptions = endpoint(
    {
        map: protect(
            user => user?.access?.products?.canSeeProducts, //see
            async ({productIds}) => {
                const finalProductIds = [].concat(productIds);
                const productOptions = await db.find({productId: {$in: finalProductIds.map(id => monkid(id))}, ...limitation});

                const result = await productOptions.reduce((map, productOption) => {
                    const {productId} = productOption;
                    const key = productId.toString();

                    return map[key] == null
                    ? assoc(key, [productOption], map)
                    : assoc(key, map[key].concat(productOption), map);
                }, {});

                return result;
            }
        ),

        all: protect(
            user => user?.access?.products?.canSeeProducts, //see
            async ({productId}) => {
                return allByProductId(productId);
            }
        ),

        get: protect(
            user => user?.access?.products?.canSeeProducts, //see
            async ({_id}) => db.findOne({_id, ...limitation})
        ),

        getMergedWithProduct: protect(
            user => user?.access?.products?.canSeeProducts, //see
            async ({productIdOrProductOptionId}) => {
                return mergeOptionIntoProductById(productIdOrProductOptionId);
            }
        ),

        add: protect(
            user => user?.access?.products?.canEditProducts, //add
            async ({productId, name, englishName, properties = {}}, {login}) => {
                return db.insert({
                    productId: monkid(productId),
                    name,
                    englishName,
                    properties,
                    created_by: login,
                    created_at: dayjs().toDate(),
                    updated_at: dayjs().toDate(),
                });
            },
            ["productOptions"]
        ),

        update: protect(
            user => user?.access?.products?.canEditProducts, //add
            async ({_id, key, value}) => {
                if (!["name", "englishName"].includes(key)) return null;

                return db.update(
                    {_id},
                    {
                        $set: {
                            [key]: value,
                            updated_at: dayjs().toDate(),
                        }
                    }
                )
            },
            ["productOptions"]
        ),

        updateProperty: protect(
            user => user?.access?.products?.canEditProducts,
            async ({_id, key, value}) => {
                const productOption = await db.findOne({_id});
                const updatedProperties = assoc(key, value, productOption.properties);
                return db.update(
                    {_id},
                    {
                        $set: {
                            properties: updatedProperties,
                            updated_at: dayjs().toDate()
                        }
                    }
                );
            },
            ["productOptions"]
        ),

        remove: protect(
            user => user?.access?.products?.canEditProducts, //add
            ({_id}) => {
                return db.update(
                    {_id},
                    {
                        $set: {deleted_at: dayjs().toDate()}
                    }
                );
            },
            ["productOptions"]
        )
    },
    {
        db,
        allByProductId,
        getOptionAndProduct,
        getOption,
        optionIsTemplate,
        mergeOptionIntoProductById,
        mergeOptionIntoProductByData,
    }
)
