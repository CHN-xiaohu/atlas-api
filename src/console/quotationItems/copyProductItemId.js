import {mongo} from "../../lib/db";
import {forEachP} from "../../helper";
import {print} from "../helper";

const quotationItemsDb = mongo.get("new_quotation_items");
const productsDb = mongo.get("products");

(async () => {
    const quotationItems = await quotationItemsDb.find({});

    print(quotationItems.length);

    await forEachP(async (quotationItem) => {
        const productId = quotationItem.product;
        if (productId == null) return;
        const product = await productsDb.findOne({_id: productId});
        if (product?.itemId == null) return;
        await quotationItemsDb.update({_id: quotationItem._id}, {$set: {itemId: product.itemId}});
    }, quotationItems);

    print("处理完成");
})();
