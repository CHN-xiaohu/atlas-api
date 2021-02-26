import {mongo} from "../../lib/db";
import {forEachP} from "../../helper";
import {print} from "../helper";

const quotationItemsDb = mongo.get("new_quotation_items");
const productsDb = mongo.get("products");
const productOptionsDb = mongo.get("product_options");

(async () => {
    const quotationItems = await quotationItemsDb.find({deleted_at: {$eq: null}});

    await forEachP(async (quotationItem) => {
        const {product: productId} = quotationItem;

        const option = await productOptionsDb.findOne({_id: productId});

        if (option == null) return;

        const product = await productsDb.findOne({_id: option.productId});

        await quotationItemsDb.update(
            {_id: quotationItem._id},
            {
                $set: {
                    product: product._id,
                    optionId: option._id
                }
            }
        );
    }, quotationItems);

    print("处理完毕");
})();
