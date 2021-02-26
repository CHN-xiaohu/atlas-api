import {mongo} from "../../lib/db";
import {print} from "../helper";
import {forEachP} from "../../helper";

const db = mongo.get("logs");

(async () => {
    const logs = await db.find({type: "lead", event: "change", oldValue: {$type: "object"}, newValue: {$type: "object"}});

    print(`一共有 ${logs.length} 个 logs 需要被处理`);

    await forEachP(async log => {
        await db.update({_id: log._id}, {$set: {oldValue: JSON.stringify(log.oldValue), newValue: JSON.stringify(log.newValue)}});
    }, logs);

    print("处理完毕");
})();
