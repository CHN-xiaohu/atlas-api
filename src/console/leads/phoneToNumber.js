import {mongo} from "../../lib/db";
import {forEachP} from "../../helper";
import {print} from "../helper";
import {assoc} from "ramda";

const db = mongo.get("leads");

(async () => {
    const leads = await db.find({"contacts.whatsapp": {$type: "string"}});

    print(`一共有 ${leads.length} 个 leads 需要处理`);

    await forEachP(async lead => {
        const contacts = lead.contacts.map(contact => {
            if (contact.whatsapp == null || typeof contact.whatsapp !== "string") return contact;

            const whatsapp = contact.whatsapp.startsWith("+")
            ? parseInt(contact.whatsapp.slice(1))
            : parseInt(contact.whatsapp);

            return assoc("whatsapp", whatsapp, contact);
        })

        await db.update({_id: lead._id}, {$set: {contacts}});
    }, leads);

    print("处理完毕");
})();
