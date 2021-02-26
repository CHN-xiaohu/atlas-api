import {mongo, id as monkid} from "../../lib/db";
import {mkdirpIfNotExists, mapP} from "../../helper";
import {print, printArea} from "../helper";
import fs from "fs";
import {promisify} from "util";
import {assoc} from "ramda";

const fields = [
    "contact_name",
    "phone",
    "email",
    "whatsapp",
    "wechat",
    "viber",
    "telegram",
];

const writeFile = promisify(fs.writeFile);

const db = mongo.get("leads");

const basePath = "/var/www/html/files/console/newContacts";
const originalPath = `${basePath}/original.json`;
const newPath = `${basePath}/new.json`;

(async () => {
    await mkdirpIfNotExists(basePath);

    const leads = await db.find({contacts: {$eq: null}});

    await printArea("保存原数据...", async () => {
        await writeFile(originalPath, JSON.stringify({leadsLength: leads.length, leads}));
    });

    const preparedLeads = await printArea(`开始处理数据，一共有 ${leads.length} 条数据需要被处理...`, async () => {
        return leads.map(lead => {
            const contact = fields.reduce((acc, field) => lead[field] == null ? acc : assoc(field, lead[field], acc), {});
            return assoc("contacts", [assoc("_id", monkid(), contact)], lead);
        });
    });

    const newLeads = await printArea(`开始存储到数据库中...`, async () => {
        return await mapP(async (lead) =>
            await db.findOneAndUpdate({_id: lead._id}, {$set: {contacts: lead.contacts}})
        , preparedLeads);
    });

    await printArea(`保存新数据...`, async () => {
        await writeFile(newPath, JSON.stringify({leadsLength: newLeads.length, leads: newLeads}));
    });

    print("处理完毕");
})();
