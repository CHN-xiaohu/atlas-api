import {mongo} from "../../lib/db";
import {numberToItemId} from "../../helper";

const db = mongo.get('products');

(async () => {
    const productsToUpdate = await db.find({}, {sort: {_id: 1}});
    productsToUpdate.forEach((product, i) => {
        db.update({_id: product._id}, {$set: {itemId: numberToItemId(i)}});
    })
})()
