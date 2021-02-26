import {endpoint, protect, unsafe} from "../lib/api-helper";
import {mongo, id as monkid} from "../lib/db";

import crypto from "crypto";
import fs from "fs";
import util from "util";
import dayjs from "dayjs";
import {endpoints} from "../lib/endpoints";
import {config, filesOperator} from "../lib/qiniuyun";
import {generateId} from "../helper";
import shell from "shelljs";

const {promisify} = util;
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const stat = promisify(fs.stat);
const rm = promisify(fs.rm);

const generateChecksum = (str, algorithm = "md5", encoding = "hex") =>
    crypto.createHash(algorithm).update(str, "utf8").digest(encoding);

const db = mongo.get("files");

const renameForPath = (link, name) => {
    return link.slice(0, link.lastIndexOf("/")).concat("/").concat(name);
}

const getKeyForPath = (link) => {
    return link.slice(link.lastIndexOf("/", link.lastIndexOf("/", link.lastIndexOf("/") - 1) - 1) + 1);
}

const renameForFile = (file, name) => {
    return [
        ["nameOnDisk", "name"],
        ["name", "name"],
        ["originalName", "name"],
        ["filename", "name"],
        ["link", "path"],
        ["pathOnDisk", "path"],
        ["url", "path"],
    ].reduce((acc, item) => {
        const key = item[0];
        const type = item[1];

        return file[key] == null
        ? acc
        : type === "name"
        ? {...acc, [key]: name}
        : {...acc, [key]: renameForPath(file[key], name)}
    }, {});
};

const preprocessFile = async (file) => {
    const PROCESS_PDF_TMP_PATH = "/tmp";
    const {
        path: filepath,
        name: originalName,
        type: originalType,
        size,
        lastModifiedDate
    } = file;

    const defaultResult = {
        filepath,
        originalName,
        originalType,
        size,
        lastModifiedDate,
        clear: () => {}
    };
    if (originalType === "application/pdf") {
        try {
            const linearizedPdfFilename = `${PROCESS_PDF_TMP_PATH}/${generateId()}.pdf`;
            await (new Promise((resolve, reject) => {
                shell.exec(`qpdf --linearize ${filepath} ${linearizedPdfFilename}`, async (code, _stdout, _stderr) => {
                    code === 0 ? resolve() : reject(code);
                })
            }));
            const {size} = await stat(linearizedPdfFilename);
            const clear = () => rm(linearizedPdfFilename);
            return {
                ...defaultResult,
                filepath: linearizedPdfFilename,
                size,
                clear
            };
        } catch (e) {
            return defaultResult;
        }
    }

    return defaultResult;
};

export const files = endpoint(
    {
        catalogues: protect(
            user => user?.access?.products?.canSeeProducts,
            async ({ids}) => {
                if (ids == null || !Array.isArray(ids)) {
                    return [];
                }
                return await db.find({_id: {$in: ids}});
            },
        ),

        rename: protect(
            user => user?.access?.files?.canEditFile,
            async ({_id, name}) => {
                const file = await db.findOne({_id});
                if (file == null || file.nameOnDisk === name) return null;
                if (
                    file.link.startsWith(config.buckets.proFiles.linkPrefix)
                    || file.link.startsWith(config.buckets.devFiles.linkPrefix)
                ) {
                    const srcKey = getKeyForPath(file.link);
                    const destKey = renameForPath(srcKey, name);
                    await filesOperator.move(srcKey, destKey);
                    await db.findOneAndUpdate(
                        {_id},
                        {$set: renameForFile(file, name)}
                    );

                    if (file.hash != null) {
                        const files = await db.find({hash: file.hash});
                        files.forEach(item => {
                            db.update(
                                {_id: monkid(item._id)},
                                {$set: renameForFile(item, name)}
                            );
                        })
                    }
                } else {
                    await (new Promise((resolve, reject) => {
                        fs.open(renameForPath(file.pathOnDisk, name), "r", async (err) => {
                            if (err?.code === "ENOENT") {
                                const updatedFile = await db.findOneAndUpdate(
                                    {_id},
                                    {$set: renameForFile(file, name)}
                                );
                                fs.rename(file.pathOnDisk, updatedFile.pathOnDisk, resolve);
                            } else {
                                reject("命名冲突");
                            }
                        })
                    }));
                }

            }
        ),
    },
    {
        db,
        addFile: unsafe(
            async (file, type, isPublic = false) => {
                const KEY_PREFIX = "files/";

                const {
                    filepath,
                    originalName,
                    originalType,
                    size,
                    lastModifiedDate,
                    clear
                } = await preprocessFile(file[Object.keys(file)[0]]);

                try {
                    const data = await readFile(filepath);
                    const hash = await generateChecksum(data);

                    const existing = isPublic
                    ? await db.findOneAndUpdate({hash, type}, {$set: {isPublic}})
                    : await db.findOne({hash, type});

                    if (existing != null) return existing;

                    const randomString = filesOperator.generateRandomFilename();
                    const destinationFilePath = `${KEY_PREFIX}${randomString}/${originalName}`;
                    await filesOperator.uploadFile(filepath, destinationFilePath);

                    const link = filesOperator.getFileLink(destinationFilePath);
                    return db.insert({
                        link,
                        nameOnDisk: originalName,
                        pathOnDisk: link,
                        created: dayjs().unix(),
                        type,
                        originalType,
                        originalName,
                        size,
                        hash,
                        lastModifiedDate,
                        isPublic
                    });
                } finally {
                    clear();
                }
            },
            ["files"],
        ),
        saveFile: unsafe(
            async (file, info) => {
                const TMP_PATH = "/var/www/html/files";
                const KEY_PREFIX = "files/";

                const randomString = filesOperator.generateRandomFilename();
                const {filename} = info;
                const sourceFilePath = `${TMP_PATH}/${randomString}-${filename}`;
                const destinationFilePath = `${KEY_PREFIX}${randomString}/${filename}`;

                await writeFile(sourceFilePath, file);
                await filesOperator.uploadFile(sourceFilePath, destinationFilePath);
                fs.unlink(sourceFilePath, () => {});

                const link = filesOperator.getFileLink(destinationFilePath);
                return db.insert({
                    ...info,
                    link: link, // eg. http://www.xxx.com/images/1.jpg
                    nameOnDisk: filename, // eg. 1.jpg
                    pathOnDisk: link, // eg. http://www.xxx.com/images/1.jpg
                    modified: dayjs().toDate(),
                });
            },
            ["files"],
        ),
        getFiles: async params => {
            return await db.find(params);
        },
        getFile: async ({_id}) => {
            return db.findOne({_id});
        },

        getFileLink: async ({_id}) => {
            const file = await endpoints.files.getFile({_id});
            return file == null ? null : file.link;
        },
    },
);

