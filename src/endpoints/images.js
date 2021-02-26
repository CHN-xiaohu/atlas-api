import {endpoint, unsafe} from "../lib/api-helper";
import {mongo} from "../lib/db";
import {endpoints} from "../lib/endpoints";

import dayjs from "dayjs";
import {imagesOperator, proImagesOperator, devImagesOperator, config} from "../lib/qiniuyun";
import fs from "fs";
import sharp from "sharp";
import {assoc} from "ramda";
import {idRegex} from "../helper";
import {promisify} from "util";

const mkdir = promisify(fs.mkdir);
const copyFile = promisify(fs.copyFile);
const exists = async path => {
    return new Promise(resolve => {
        fs.access(path, fs.constants.F_OK, err => {
            if (err) {
                resolve(false);
            } else {
                resolve(true);
            }
        });
    });
};
const mkdirpIfNotExists = async path => {
    if (!(await exists(path))) await mkdir(path, {recursive: true});
};

const IS_PRODUCTION = process.env.NODE_ENV === "production";

const db = mongo.get("images");

const min = (a, b) => (a < b ? a : b);

const getAutoHeight = (srcWidth, srcHeight, distWidth) => {
    return Math.round(distWidth / (srcWidth / srcHeight));
};

const getAutoWidth = (srcWidth, srcHeight, distHeight) => {
    return Math.round((srcWidth / srcHeight) * distHeight);
};

const getContainResizeOption = (width, height, meta) => {
    const [picWidth, picHeight] = meta.orientation === 6 ? [meta.height, meta.width] : [meta.width, meta.height];

    return picWidth > picHeight
        ? {width, height: getAutoHeight(picWidth, picHeight, 250)}
        : {width: getAutoWidth(picWidth, picHeight, 250), height};
};

const tmpImageStyleProcessor = {
    jpg: async (originalPath, styledPath) => {
        const image = sharp(originalPath);
        await image.rotate().jpeg({quality: 90}).toFile(styledPath);
    },

    png: async (originalPath, styledPath) => {
        const image = sharp(originalPath);
        await image.rotate().toFormat("png").toFile(styledPath);
    },

    webp: async (originalPath, styledPath) => {
        const image = sharp(originalPath);
        await image.rotate().webp({quality: 90, lossless: false}).toFile(styledPath);
    },

    avatar_jpg: async (originalPath, styledPath) => {
        const image = sharp(originalPath);
        await image
            .rotate()
            .resize(getContainResizeOption(150, 150, await image.metadata()))
            .trim()
            .jpeg({quality: 90})
            .toFile(styledPath);
    },

    avatar_webp: async (originalPath, styledPath) => {
        const image = sharp(originalPath);
        await image
            .rotate()
            .resize(getContainResizeOption(150, 150, await image.metadata()))
            .trim()
            .webp({quality: 90, lossless: false})
            .toFile(styledPath);
    },

    thumbnail_jpg: async (originalPath, styledPath) => {
        const image = sharp(originalPath);
        await image
            .rotate()
            .resize(getContainResizeOption(250, 250, await image.metadata()))
            .trim()
            .jpeg({quality: 90})
            .toFile(styledPath);
    },

    thumbnail_webp: async (originalPath, styledPath) => {
        const image = sharp(originalPath);
        await image
            .rotate()
            .resize(getContainResizeOption(250, 250, await image.metadata()))
            .webp({quality: 90, lossless: false})
            .toFile(styledPath);
    },

    "500x500_jpg": async (originalPath, styledPath) => {
        const image = sharp(originalPath);
        await image
            .rotate()
            .resize(getContainResizeOption(500, 500, await image.metadata()))
            .jpeg({quality: 90})
            .toFile(styledPath);
    },

    "500x500_webp": async (originalPath, styledPath) => {
        const image = sharp(originalPath);
        await image
            .rotate()
            .resize(getContainResizeOption(500, 500, await image.metadata()))
            .webp({quality: 90, lossless: false})
            .toFile(styledPath);
    },
};

const tmpImageSupportStyles = Object.keys(tmpImageStyleProcessor).concat("original");
const tmpImageStyleConfig = tmpImageSupportStyles.reduce((acc, style) => {
    return assoc(
        style,
        {
            dirPath: `/var/www/html/files/tmp_qiniuyun_images/${style}`,
            linkPrefix: `https://files.globus.furniture/tmp_qiniuyun_images/${style}`,
        },
        acc,
    );
}, {});
const getTmpFilePath = (style, id) => `${tmpImageStyleConfig[style].dirPath}/${id}`;
const getTmpFileLink = (style, id) => `${tmpImageStyleConfig[style].linkPrefix}/${id}`;
const mkdirTmpDirIfNotExists = async style => {
    const path = tmpImageStyleConfig[style].dirPath;
    await mkdirpIfNotExists(path);
};

const styleTmpImage = async (style, imageNode) => {
    const originalPath = getTmpFilePath("original", imageNode._id);

    if (!(await exists(originalPath))) return null;

    if (!tmpImageSupportStyles.includes(style)) {
        return getTmpFileLink("original", imageNode._id);
    }

    const styledPath = getTmpFilePath(style, imageNode._id);

    if (!(await exists(styledPath))) {
        await mkdirTmpDirIfNotExists(style);
        await tmpImageStyleProcessor[style](originalPath, styledPath);
    }

    return getTmpFileLink(style, imageNode._id);
};

const tmpImageCountdownDelete = imageNode => {
    if (imageNode.startCountdownToDeleteTmp === false) {
        // start countdown to delete the tmp image
        endpoints.images.db.update(
            {_id: imageNode._id},
            {
                $set: {startCountdownToDeleteTmp: true},
            },
        );

        setTimeout(() => {
            (async () => {
                tmpImageSupportStyles.forEach(style => {
                    fs.unlink(getTmpFilePath(style, imageNode._id), () => {});
                });

                endpoints.images.db.update(
                    {_id: imageNode._id},
                    {
                        $set: {
                            hasTmp: false,
                            startCountdownToDeleteTmp: false,
                        },
                    },
                );
            })();
        }, 60000);
    }
};

const getTmpImage = async (style, imageNode) => {
    tmpImageCountdownDelete(imageNode);

    const link = await styleTmpImage(style, imageNode);

    return link == null
        ? null
        : {
              link,
              httpStatusCode: 302,
          };
};

const getOriginalImageLink = async (imageNode, style) => {
    if (imageNode.hasTmp) {
        return await getTmpImage(style, imageNode);
    }

    if (imageNode.isDevelopment) {
        return {
            link: devImagesOperator.getFileLink(`${imageNode.originalKey}${config.styleSeparator}${style}`),
            httpStatusCode: 301,
        };
    } else {
        return {
            link: proImagesOperator.getFileLink(`${imageNode.originalKey}${config.styleSeparator}${style}`),
            httpStatusCode: 301,
        };
    }
};

const getWatermarkImageLink = (imageNode, style) => {
    if (imageNode.isDevelopment) {
        return {
            link: devImagesOperator.getFileLink(`${imageNode.watermarkKey}${config.styleSeparator}${style}`),
            httpStatusCode: 301,
        };
    } else {
        return {
            link: proImagesOperator.getFileLink(`${imageNode.watermarkKey}${config.styleSeparator}${style}`),
            httpStatusCode: 301,
        };
    }
};

const createImageNode = (originalKey, watermarkKey, file, isPublic, expireIn, showImmediately, meta) => ({
    originalKey,
    watermarkKey,
    isPublic,
    expireIn,
    downloadCounter: 0,
    hasTmp: showImmediately,
    startCountdownToDeleteTmp: false,
    createdAt: dayjs().toDate(),

    filename: file.name,
    fileType: file.type,
    fileSize: file.size,
    fileLastModifiedDate: file.lastModifiedDate,
    meta,
    ...(!IS_PRODUCTION ? {isDevelopment: true} : {}),
});
const generateOriginalImageFilename = () => imagesOperator.generateRandomKey(config.prefixes.originalImages);
const generateWatermarkImageFilename = () => imagesOperator.generateRandomKey(config.prefixes.watermarkImages);
const saveOriginalImageToQiniu = (localFile, key) => {
    return imagesOperator.uploadFile(localFile, key);
};

const saveWatermarkImageToQiniu = (srcKey, destKey, meta) => {
    const ws = meta.height / meta.width > 1.5 ? "0.8" : "0.3";
    const minSide = min(meta.width, meta.height);
    const fontsize = Math.floor(minSide / 1.515);
    const margin = Math.floor(minSide / 5.05);

    const textWatermarkSubProcess = `watermark/4/text/${imagesOperator.base64Encode(
        "Globus",
    )}/font/${imagesOperator.base64Encode(config.watermark.font)}/fill/${imagesOperator.base64Encode(
        "gray",
    )}/dissolve/55/rotate/-30/fontsize/${fontsize}/uw/${margin}/uh/${margin}`;
    const imageWatermarkSubProcess = `watermark/1/image/${imagesOperator.base64Encode(
        config.watermark.link,
    )}/dissolve/50/gravity/SouthWest/ws/${ws}/wst/2`;
    const watermarkProcess = `${textWatermarkSubProcess}|${imageWatermarkSubProcess}`;
    imagesOperator.persistentOne(watermarkProcess, srcKey, destKey, config.pipelins.watermark);
};

export const images = endpoint(
    {},
    {
        db,
        upload: unsafe(
            async ({file, isPublic, expireIn, showImmediately}) => {
                // if (user === null) return null;// TODO: response null
                const meta = await sharp(file.path).metadata();
                const originalKey = generateOriginalImageFilename();
                const watermarkKey = generateWatermarkImageFilename();
                await saveOriginalImageToQiniu(file.path, originalKey);
                saveWatermarkImageToQiniu(originalKey, watermarkKey, meta);
                const node = createImageNode(
                    originalKey,
                    watermarkKey,
                    file,
                    isPublic,
                    expireIn,
                    showImmediately,
                    meta,
                );
                const data = await endpoints.images.db.insert(node);

                if (showImmediately === true) {
                    const destPath = getTmpFilePath("original", data._id);
                    await mkdirTmpDirIfNotExists("original");
                    await copyFile(file.path, destPath, fs.constants.COPYFILE_EXCL);
                }

                return data;
            },
            ["images"],
        ),
        get: async ({photo}, user) => {
            // console.log(id, styles, user);
            // return 'https://globus.furniture'

            //return null for 404 error
            //return link for 302/301 redirect

            const IS_LOGIN = user != null;
            const [id, style] = photo.split(config.styleSeparator);

            if (!idRegex.test(id)) return null;

            const image = await endpoints.images.db.findOneAndUpdate(
                {_id: id},
                {
                    $set: {requestedAt: dayjs().toDate()},
                    $inc: {downloadCounter: 1},
                },
            );

            if (image == null) {
                return null;
            }

            if (IS_LOGIN || image.isPublic) {
                return await getOriginalImageLink(image, style);
            } else {
                return getWatermarkImageLink(image, style);
            }
        },
    },
);
