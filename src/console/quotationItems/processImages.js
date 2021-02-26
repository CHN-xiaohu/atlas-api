import fs from "fs";
import util from "util";
import {mongo} from "../../lib/db";
import {mapP, forEachP} from "../../helper";
import {findIndex, assoc} from "ramda";

const {promisify} = util;
const readFile = promisify(fs.readFile);

const quotationItemsDb = mongo.get("new_quotation_items");
const productsDb = mongo.get("products");

const basePath = "/var/www/html/files";
const infoFilePath = `${basePath}/123abcindex.json`;


(async () => {
    console.log("[console script] 获取 quotations items 数据中...");
    const quotationItems = await quotationItemsDb.find({photos: {$regex: /https:\/\/files\.globus\.furniture/}}, {projection: {_id: 1, photos: 1}});

    console.log("[console script] 读取 123abcindex.json 文件中...");
    const data = await readFile(infoFilePath, {encoding: "utf-8"});
    const info = JSON.parse(data);

    console.log(`[console script] 一共有 ${quotationItems.length} 个 quotationItems 需要处理`);
    console.log(`[console script] 开始替换为新数据...`);
    const processedQuotationItems = await mapP(async (quotationItem, _key, index) => {
        const processedPhotos = await mapP(async (photo) => {
            const product = info.find(product => {
                const foundPhoto = product.photos.find(photoOfProduct => photo === photoOfProduct);
                return foundPhoto != null;
            });

            if (product == null) {
                console.log("[console script] 错误: 没有找到对应的图片", quotationItem);
                return photo;
            }

            const indexOfPhotoOfProduct = findIndex(photoOfProduct => photoOfProduct === photo, product.photos);

            const productFromDb = await productsDb.findOne({_id: product._id}, {projection: {photos: 1}});
            const imageId = productFromDb.photos[indexOfPhotoOfProduct];
            return imageId;
        }, quotationItem.photos);

        console.log(`[console script] 第 ${index + 1} 个 quotationItems 替换成功`);
        return assoc("photos", processedPhotos, quotationItem);
    }, quotationItems);

    console.log(`[console script] 开始更新数据库...`)
    await forEachP(async ({_id, photos}, _key, index) => {
        await quotationItemsDb.update({_id}, {$set: {photos}});
        console.log(`[console script] 第 ${index + 1} 个 quotation item 更新成功`);
    }, processedQuotationItems);

    console.log("[console script] 执行完毕");
})()
