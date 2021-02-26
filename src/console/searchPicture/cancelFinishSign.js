import {mongo} from "../../lib/db";
const productsDb = mongo.get("products");

(async () => {
    await productsDb.update({addedToSearchLibrary: true}, {$set: {addedToSearchLibrary: false}});
    console.log("处理完毕");
})();
