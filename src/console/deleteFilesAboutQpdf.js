import fs from "fs";
import util from "util";
import {reduceP} from "../helper";
import {proFilesOperator} from "../lib/qiniuyun";

const {promisify} = util;
const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

const dirPath = "/Users/chenhaonan/Desktop/tmp/qiniu_storage2";
(async () => {
    const infoPaths = (new Array(12)).fill(0).map((_value, index) => `${dirPath}/informations/1-${index}.json`);

    const errors = await reduceP(async (errors, path, _key, part) => {
        const data = await readFile(path, {encoding: "utf-8"});
        const infos = JSON.parse(data);
        return errors.concat(await reduceP(async (errors, resource, _key, index) => {
            const {key} = resource;

            try {
                await proFilesOperator.delete(key);
            } catch (error) {
                console.log(`[console script] 删除重试1[${part}-${index}]`);
                try {
                    await proFilesOperator.delete(key);
                } catch (error) {
                    console.log(`[console script] 删除重试2[${part}-${index}]`);
                    try {
                        await proFilesOperator.delete(key);
                    } catch (error) {
                        console.log(`[console script] 删除失败[${part}-${index}] ${key}`, error);
                        return errors.concat({part, index, resource, error});
                    }
                }
            }
            console.log(`[console script] 删除成功[${part}-${index}] ${key}`);
            return errors;
        }, [], infos));
    }, [], infoPaths);

    console.log("出现的错误有：", errors);
    console.log("保存错误文件...");
    await writeFile(`${dirPath}/delete/errors.json`, JSON.stringify(errors));
    console.log("执行完毕！");
})();
