import fs from "fs";
import util from "util";
import {reduceP} from "../../helper";

const {promisify} = util;
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const rename = promisify(fs.rename);
const mkdir = promisify(fs.mkdir);
const getFilenameByPath = (path) => path.slice(path.lastIndexOf("/") + 1);
const exists = async (path) => {
    return new Promise((resolve) => {
        fs.access(path, fs.constants.F_OK, (err) => {
            if (err) {
                resolve(false);
            } else {
                resolve(true);
            }
        });
    })
};

const dirPath = "/var/www/html/files";
const infoFilePath = `${dirPath}/123abcindex.json`;
const backupDirPath = `${dirPath}/123abcbackup`;

(async () => {
    if (await exists(backupDirPath)) {
        console.log("[console script] 已存在 123abcbackup 目录");
        return;
    }

    await mkdir(backupDirPath);

    const data = await readFile(infoFilePath, {encoding: "utf-8"});
    const info = JSON.parse(data);
    const errors = await reduceP(async (errors, {photos}) => {
        return errors.concat(await reduceP(async (errors, photo) => {
            if (!photo.startsWith("https://files.globus.furniture")) return errors;

            const filename = getFilenameByPath(photo);
            const srcPath = `${dirPath}/${filename}`;
            const destPath = `${backupDirPath}/${filename}`;

            if (await exists(destPath)) {
                console.log("[console script] 文件名冲突", srcPath, destPath);
                return errors.concat({srcPath, destPath, error: "文件名冲突"});
            }

            try {
                await rename(srcPath, destPath);
            } catch (error) {
                console.log("[console script] 移动错误", srcPath, destPath, error);
                return errors.concat({srcPath, destPath, error});
            }

            return errors;
        }, [], photos));
    }, [], info);

    console.log("[console script] 有以下错误", errors);
    console.log("[console script] 保存错误文件...");
    await writeFile(`${backupDirPath}/123abcerrors.json`, JSON.stringify(errors));
    console.log("[console script] 执行完毕")
})();
