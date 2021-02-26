/* eslint-disable immutable/no-this */
import qiniu from "qiniu";
import {v4 as uuidv4} from "uuid";
import axios from "axios";
import crypto from "crypto";
import {compose} from "ramda";

const QINIU_API_HOST = "ai.qiniuapi.com";
const BASE_URL = `http://${QINIU_API_HOST}`
const {get, post} = axios.create({
    baseURL: BASE_URL
});

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const ACCESS_KEY = "EzLpvDkuw_b8wMA0Fui1q5DBvf2Ksr-3a3LC-Wtk";
const SECRET_KEY = "w7NwwISwIgg_Vq1y44VVMDtZk4hgVnyanFebRW02";
const MAC = new qiniu.auth.digest.Mac(ACCESS_KEY, SECRET_KEY);
const ZONE = qiniu.zone.zoneNa0;

qiniu.conf.ACCESS_KEY = ACCESS_KEY;
qiniu.conf.SECRET_KEY = SECRET_KEY;

// eslint-disable-next-line functional/no-class
export class Operator {
    constructor({bucketName, linkPrefix, zone, pictureSearchLibrary}) {
        this._bucketName = bucketName;
        this._linkPrefix = linkPrefix;
        this._zone = zone;
        this._pictureSearchLibrary = pictureSearchLibrary;

        const config = new qiniu.conf.Config();
        config.zone = qiniu.zone.zoneNa0;
        config.useHttpsDomain = this._linkPrefix.startsWith("https");
        this._bucketManager = new qiniu.rs.BucketManager(MAC, config);
    }

    generateUploadToken() {
        const options = {
            scope: this._bucketName,
        };
        const putPolicy = new qiniu.rs.PutPolicy(options);

        return putPolicy.uploadToken(MAC);
    }

    /**
     *
     * @param {*} srcLocalFileName the path of source file
     * @param {*} destKey the key of destination file
     */
    uploadFile(srcLocalFilePath, destKey) {
        const config = new qiniu.conf.Config();
        config.zone = this._zone;

        const uploadToken = this.generateUploadToken();

        const formUploader = new qiniu.form_up.FormUploader(config);
        const putExtra = new qiniu.form_up.PutExtra();
        return new Promise((resolve, reject) => {
            formUploader.putFile(uploadToken, destKey, srcLocalFilePath, putExtra, function (
                respErr,
                respBody,
                respInfo,
            ) {
                if (respErr) reject(respErr);
                if (respInfo?.statusCode === 200) resolve(respBody);
                else reject(respBody);
            });
        });
    }

    move(srcKey, destKey) {
        return new Promise((resolve, reject) => {
            this._bucketManager.move(
                this._bucketName,
                srcKey,
                this._bucketName,
                destKey,
                {force: false},
                (e, respBody, respInfo) => {
                    if (e == null && respBody?.error == null && respInfo?.status === 200) {
                        resolve();
                    } else {
                        reject(respBody?.error);
                    }
                }
            )
        });
    }

    delete(key) {
        return new Promise((resolve, reject) => {
            this._bucketManager.delete(
                this._bucketName,
                key,
                (e, respBody, respInfo) => {
                    if (e == null && respBody?.error == null && respInfo?.status === 200) {
                        resolve();
                    } else {
                        reject(respBody?.error);
                    }
                }
            )
        })
    }

    /**
     *
     * @param {*} operation
     * @param {*} srcKey
     * @param {*} destKey
     * @param {*} pipeline
     * @param {*} destBucketName
     * @param {*} options {notifyURL: "http://api.example.com/pfopCallback", force: false}
     */
    persistentOne(operation, srcKey, destKey, pipeline, destBucketName = this._bucketName, options = {}) {
        const config = new qiniu.conf.Config();
        config.zone = qiniu.zone.zoneNa0;
        config.useHttpsDomain = this._linkPrefix.startsWith("https");
        const operManager = new qiniu.fop.OperationManager(MAC, config);

        const saveProcess = `saveas/${qiniu.util.urlsafeBase64Encode(destBucketName + ":" + destKey)}`;
        const fops = [operation + "|" + saveProcess];

        return new Promise((resolve, reject) => {
            operManager.pfop(this._bucketName, srcKey, fops, pipeline, options, function (err, respBody, respInfo) {
                const result = {err, respBody, respInfo};
                if (err) reject(result);
                else resolve(result);
            });
        });
    }

    getFileLink(key) {
        return `${this._linkPrefix}/${key}`;
    }
    generateRandomFilename() {
        return uuidv4();
    }
    generateRandomKey(prefix = "") {
        return prefix + uuidv4();
    }
    base64Encode(str) {
        return qiniu.util.urlsafeBase64Encode(str);
    }


    /*************************************
     *              以图搜图              *
     *************************************/
    getAuthorization ({method, host = QINIU_API_HOST, path, contentType = null, bodyStr = null}) {
        const data = compose(
            str => bodyStr != null && contentType != null && contentType !== "application/octet-stream" ? str + bodyStr : str,
            str => str + "\n\n",
            str => contentType != null ? str + `\nContent-Type: ${contentType}` : str,
            () => `${method.toUpperCase()} ${path}\nHost: ${host}`
        )();

        const hmac = crypto.createHmac('sha1', SECRET_KEY);
        hmac.update(data);
        const sign = hmac.digest();

        const encodedSign = this.base64Encode(sign);
        const token = `Qiniu ${ACCESS_KEY}:${encodedSign}`;

        return token;
    }

    /**
     * @param {*} images [{url: "http://xx.com/xxx", attribute: {id: "<id>", label: "<label>", desc: "<desc>"}}]
     */
    async createImageSearchLibrary (images = []) {
        const path = `/v1/image/group/${this._pictureSearchLibrary}/new`;
        const contentType = "application/json";
        const bodyStr = JSON.stringify({data: images});

        const authorization = this.getAuthorization({method: "POST", path, contentType, bodyStr});

        return post(path, bodyStr, {
            headers: {
                "Content-Type": contentType,
                Authorization: authorization
            }
        });
    }

    async removeImageSearchLibrary () {
        const path = `/v1/image/group/${this._pictureSearchLibrary}/remove`;
        const contentType = "application/json";
        const authorization = this.getAuthorization({method: "POST", path, contentType});

        return post(path, undefined, {
            headers: {
                "Content-Type": contentType,
                Authorization: authorization
            }
        });
    }

    /**
     * @param {*} images [{url: "http://xx.com/xxx", attribute: {id: "<id>", label: "<label>", desc: "<desc>"}}]
     */
    async addImagesToLibrary (images) {
        const path = `/v1/image/group/${this._pictureSearchLibrary}/add`;
        const contentType = "application/json";
        const bodyStr = JSON.stringify({data: images});

        const authorization = this.getAuthorization({method: "POST", path, contentType, bodyStr});

        return post(path, bodyStr, {
            headers: {
                "Content-Type": contentType,
                Authorization: authorization
            }
        });
    }

    /**
     * @param {*} images ["<image_id>", "<image_id>", "<image_id>"]
     */
    async removeImagesOnLibrary (images) {
        const path = `/v1/image/group/${this._pictureSearchLibrary}/delete`;
        const contentType = "application/json";
        const bodyStr = JSON.stringify({images});

        const authorization = this.getAuthorization({method: "POST", path, contentType, bodyStr});

        return post(path, bodyStr, {
            headers: {
                "Content-Type": contentType,
                Authorization: authorization
            }
        })
    }

    async showAllLibraries () {
        const path = `/v1/image/group`;

        const authorization = this.getAuthorization({method: "GET", path});

        return get(path, null, {
            headers: {
                Authorization: authorization
            }
        });
    }

    async showLibraryInfo () {
        const path = `/v1/image/group/${this._pictureSearchLibrary}/info`;

        const authorization = this.getAuthorization({method: "GET", path});

        return get(path, null, {
            headers: {
                Authorization: authorization
            }
        });
    }

    async showAllImagesOnLibrary () {
        const path = `/v1/image/group/${this._pictureSearchLibrary}`;
        const authorization = this.getAuthorization({method: "GET", path});

        return get(path, {
            headers: {
                Authorization: authorization
            }
        });
    }

    /**
     *
     * @param {*} uri 要搜索的图片，支持两种资源表达方式： 1、uri 2、base64
     * @param {*} limit
     * @param {*} threshold
     */
    async searchImage (uri, limit = 1, threshold = 0.85, groupIds = null) {
        const body = {
            data: {uri},
            params: {
                groups: [].concat(groupIds == null ? this._pictureSearchLibrary : groupIds),
                limit,
                threshold
            }
        };

        const path = `/v1/image/groups/search`;
        const contentType = "application/json";
        const bodyStr = JSON.stringify(body);

        const authorization = this.getAuthorization({method: "POST", path, contentType, bodyStr});

        return post(path, bodyStr, {
            headers: {
                "Content-Type": contentType,
                Authorization: authorization
            }
        });
    }

    async getImageInfoOnLibrary (id) {
        const body = {id};

        const path = `/v1/image/group/${this._pictureSearchLibrary}/image`;
        const contentType = "application/json";
        const bodyStr = JSON.stringify(body);

        const authorization = this.getAuthorization({method: "POST", path, contentType, bodyStr});

        return post(path, bodyStr, {
            headers: {
                "Content-Type": contentType,
                Authorization: authorization
            }
        });
    }
}

export const config = {
    styleSeparator: "|",

    buckets: {
        proFiles: {
            bucketName: "globusfiles",
            zone: ZONE,
            linkPrefix: "https://storage.globus.furniture",
        },

        proImages: {
            bucketName: "globusatlas",
            zone: ZONE,
            linkPrefix: "https://images.globus.furniture",
            pictureSearchLibrary: "products"
        },

        devFiles: {
            bucketName: "globustest",
            zone: ZONE,
            linkPrefix: "https://test.globus.furniture",
        },

        devImages: {
            bucketName: "globustest",
            zone: ZONE,
            linkPrefix: "https://test.globus.furniture",
            pictureSearchLibrary: "test-products"
        }
    },

    watermark: {
        link: "https://storage.globus.furniture/assets/watermark4.png",
        font: "consolas",
    },

    pipelins: {
        watermark: "watermark",
    },

    prefixes: {
        originalImages: "original-images/",
        watermarkImages: "images/",
    },
};

export const proFilesOperator = new Operator(config.buckets.proFiles);
export const proImagesOperator = new Operator(config.buckets.proImages);
export const devFilesOperator = new Operator(config.buckets.devFiles);
export const devImagesOperator = new Operator(config.buckets.devImages);
export const filesOperator = IS_PRODUCTION ? proFilesOperator : devFilesOperator;
export const imagesOperator = IS_PRODUCTION ? proImagesOperator : devImagesOperator;
