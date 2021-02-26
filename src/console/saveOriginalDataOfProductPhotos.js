import {endpoints} from "../lib/endpoints";
import {util} from "util";
import fs from "fs";

const {promisify} = util;
const writeFile = promisify(fs.writeFile);

const productsDb = endpoints.products.db;

const dirPath = "/var/www/html/files";

(async () => {
    const allProducts = await productsDb.find({photos: {$regex: /https:\/\/files\.globus\.furniture/}}, {projection: {photos: 1, _id: 1}});
    console.log(`[console script] 需要处理的 Products 有 ${allProducts.length} 条`);
    writeFile(`${dirPath}/123abcindex.json`, JSON.stringify(allProducts));
})();
