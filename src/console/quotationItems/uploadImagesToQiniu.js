import {mongo} from "../../lib/db";
import {forEachP, mapP} from "../../helper";
import {endpoints} from "../../lib/endpoints";
import sharp from "sharp";
import dayjs from "dayjs";
import process from "process";
import fs from "fs";
import util from "util";
const {promisify} = util;

const writeFile = promisify(fs.writeFile);

const quotationItemsDb = mongo.get("new_quotation_items");

const basePath = "/var/www/html/files";
const originalInfoFilePath = `${basePath}/quotationItemImagesOriginalInfo4.json`;
const newInfoFilePath = `${basePath}/quotationItemImagesNewInfo4.json`;
const errorsPath = `${basePath}/quotationItemImagesErrors4.json`;


process.on('warning', (warning) => {
    console.warn(warning.name);    // Print the warning name
    console.warn(warning.message); // Print the warning message
    console.warn(warning.stack);   // Print the stack trace
});
process.on('unhandledRejection', (reason, promise) => {
    console.log('Unhandled Rejection at:', promise, 'reason:', reason);
    console.dir(promise, {depth: 10});
    console.dir(reason, {depth: 10});
    // Application specific logging, throwing an error, or other logic here
});

const getFilenameByPath = (path) => path.slice(path.lastIndexOf("/") + 1);
const toFile = async (path) => {
    const metadata = await sharp(path).metadata();
    return {
        path,
        name: getFilenameByPath(path),
        type: "image/" + metadata.format,
        size: metadata.size,
        lastModifiedDate: new Date()
    }
};

const processUpload = async (photo) => {
    const filename = getFilenameByPath(photo);
    const localpath = `${basePath}/${filename}`;
    const file = await toFile(localpath);
    const {_id} = await endpoints.images.upload({
        file,
        isPublic: false,
        showImmediately: false,
        expireIn: dayjs().add(1, "year").toDate(),
    });
    return _id.toString();
};

(async () => {
    console.log("[console script] 获取 quotation items 数据中...");
    const quotationItems = await quotationItemsDb.find({photos: {$regex: /https:\/\/files\.globus\.furniture/}}, {projection: {_id: 1, photos: 1}});

    console.log("[console script] 保存 quotation items 原本数据...");
    await writeFile(originalInfoFilePath, JSON.stringify({length: quotationItems.length, original: quotationItems}));

    // 将 quotationItems 本地图片上传到七牛云
    console.log(`[console script] 需要处理的 quotation items 有 ${quotationItems.length} 条`);
    console.log(`[console script] 开始处理上传七牛云...`);

    const errors = [];
    const newInfo = [];
    await forEachP(async (item, _key, index) => {
        const photos = await mapP(async (photo) => {
            if (!photo.startsWith("https://files.globus.furniture")) return photo;
            try {
                return await processUpload(photo);
            } catch (error) {
                try {
                    console.log(`[console script] 重试一次[${index}]`);
                    return await processUpload(photo);
                } catch (error) {
                    try {
                        console.log(`[console script] 重试两次[${index}]`);
                        return await processUpload(photo);
                    } catch (error) {
                        errors.push({item, photo, error});
                        console.log(`[console script] 错误[${index}]: `, {item, photo, error});
                        return photo;
                    }
                }
            }

        }, item.photos);


        try {
            const newItem = await quotationItemsDb.findOneAndUpdate({_id: item._id}, {$set: {photos}}, {projection: {_id: 1, photos: 1}});
            newInfo.push(newItem);
            console.log(`[console script] 处理完毕[${index}]: `, newItem._id);
        } catch (error) {
            try {
                console.log(`[console script] 写入数据库重试一次[${index}]`);
                const newItem = await quotationItemsDb.findOneAndUpdate({_id: item._id}, {$set: {photos}}, {projection: {_id: 1, photos: 1}});
                newInfo.push(newItem);
                console.log(`[console script] 处理完毕[${index}]: `, newItem._id);
            } catch (error) {
                try {
                    console.log(`[console script] 写入数据库重试两次[${index}]`);
                    const newItem = await quotationItemsDb.findOneAndUpdate({_id: item._id}, {$set: {photos}}, {projection: {_id: 1, photos: 1}});
                    newInfo.push(newItem);
                    console.log(`[console script] 处理完毕[${index}]: `, newItem._id);
                } catch (error) {
                    errors.push({desc: "写入数据库错误", item, photos, error});
                    console.log(`[console script] 写入数据库错误[${index}]`, {desc: "写入数据库错误", item, photos, error});
                }
            }
        }

    }, quotationItems);

    // 将更改后的 image id 输出到 infoFile
    console.log("[console script] 保存 quotation items 更新后的数据...");
    await writeFile(newInfoFilePath, JSON.stringify({length: newInfo.length, newInfo}));

    // 将错误输出到 error 文件
    console.log("[console script] 保存 quotation items 处理错误信息...");
    await writeFile(errorsPath, JSON.stringify(errors));

    console.log("[console script] 处理完毕");
})();
