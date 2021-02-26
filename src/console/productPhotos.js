import {endpoints} from "../lib/endpoints";
import {forEachP, mapP} from "../helper";
import sharp from "sharp";
import dayjs from "dayjs";

const productsDb = endpoints.products.db;

const dirPath = "/var/www/html/files";

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
}
const process = async (photo) => {
    const filename = getFilenameByPath(photo);
    const localpath = `${dirPath}/${filename}`;
    const file = await toFile(localpath);
    const {_id} = await endpoints.images.upload({
        file,
        isPublic: false,
        showImmediately: false,
        expireIn: dayjs().add(1, "year").toDate(),
    });
    return _id.toString();
}
(async () => {
    const allProducts = await productsDb.find({photos: {$regex: /https:\/\/files\.globus\.furniture/}}, {projection: {photos: 1, _id: 1}});
    console.log(`[console script] 需要处理的 Products 有 ${allProducts.length} 条`);

    //console.log(`[console script] 原本数据: `, allProducts.slice(0, 1));

    forEachP(async (product, _key, index) => {
        const photos = await mapP(async (photo) => {
            if (!photo.startsWith("https://files.globus.furniture")) return photo;
            try {
                return await process(photo);
            } catch (e) {
                console.log(`[console script] 重试1[${index}]`);
                try {
                    return await process(photo)
                } catch(e) {
                    console.log(`[console script] 重试2[${index}]`);
                    try {
                        return await process(photo)
                    } catch (e) {
                        console.log(`[console script] 上传失败[${index}]`, e, product, photo)
                        return photo;
                    }
                }
            }
        }, product.photos);

        await productsDb.update({_id: product._id}, {$set: {photos}});
        console.log(`[console script] 处理完毕[${index}]: `, product._id);
    }, allProducts);

})();
