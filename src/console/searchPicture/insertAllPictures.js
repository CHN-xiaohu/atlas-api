import {mapP, forEachP} from "../../helper";
import {mongo} from "../../lib/db";
import {proImagesOperator} from "../../lib/qiniuyun";
import fs from "fs";
import util from "util";

const {promisify} = util;
const writeFile = promisify(fs.writeFile);
const appendFile = promisify(fs.appendFile);

const basePath = "/var/www/html/files";
const errorsFilePath = `${basePath}/searchPictureErrors.json`;
const consoleInfoFilePath = `${basePath}/searchPictureConsoleInfo.json`;

const productsDb = mongo.get("products");
const imagesDb = mongo.get("images");

const consoleLog = async (...params) => {
    console.log(...params);
    await appendFile(consoleInfoFilePath, JSON.stringify(params));
}

(async () => {
    const products = await productsDb.find({photos: {$ne: null}, addedToSearchLibrary: {$ne: true}}, {projection: {_id: 1, name: 1, photos: 1}});

    const imageGroups = (await mapP(async product => {
        return await mapP(async photo => {
            const image = await imagesDb.findOne({_id: photo}, {projection: {originalKey: 1}});
            const productId = product._id.toString()
            const imageId = photo;
            return {
                uri: proImagesOperator.getFileLink(image.originalKey) + "|original",
                attribute: {
                    id: `${productId}|${imageId}`,
                    label: product.name,
                    desc: {product: productId, image: imageId}
                }
            }
        }, product.photos);
    }, products));

    await consoleLog(`[console script] 一共有 ${imageGroups.length} 批`);
    const errors = [];
    await forEachP(async (images, _key, index) => {
        if (!(images?.length > 0)) return;

        const process = async () => {
            const {data} = await proImagesOperator.addImagesToLibrary(images);
            await productsDb.update({_id: images[0].attribute.desc.product}, {$set: {addedToSearchLibrary: true}});
            await consoleLog(`[console script] 完成第 ${index} 批图片添加`, data, images);
            const hasError = data.errors.find(error => error != null) != null;
            if (hasError) {
                errors.push({images, data});
            }
        };

        try {
            await process();
        } catch (error) {
            try {
                await consoleLog("[console script] 重试一次...");
                await process();
            } catch (error) {
                try {
                    await consoleLog("[console script] 重试两次...");
                    await process();
                } catch (error) {
                    errors.push({images, error});
                    await consoleLog(`[console script] 错误: 第 ${index} 批图片添加失败`, {images, error});
                }
            }
        }

    }, imageGroups);


    await consoleLog("[console script] 期间出现了以下错误");
    await consoleLog(errors);
    await writeFile(errorsFilePath, JSON.stringify(errors));
    await consoleLog("[console script] 添加图片库完毕");
})();
