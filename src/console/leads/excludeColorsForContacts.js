import {mongo} from "../../lib/db";
import {forEachP, color as getColor, randomColor} from "../../helper";
import {print} from "../helper";
import {range, assoc} from "ramda";

const db = mongo.get("leads");

const excludeColors = ["grey"].map(color => {
    const levels = range(0, 10);
    return levels.map(level => {
        return getColor(color, level);
    })
}).flat();


(async () => {
    const leads = await db.find({"contacts.background": {$in: excludeColors}});

    print(`一共有 ${leads.length} 个 lead 需要处理`);

    await forEachP(async lead => {
        const contacts = lead.contacts.map(contact => {
            return excludeColors.includes(contact.background)
            ? assoc("background", randomColor(), contact)
            : contact;
        });
        await db.update({_id: lead._id}, {$set: {contacts}});
    }, leads);

    print("处理完成");
})();
