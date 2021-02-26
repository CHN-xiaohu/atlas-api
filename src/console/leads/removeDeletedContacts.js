import {mongo} from "../../lib/db";
import {forEachP} from "../../helper";
import {print} from "../helper";
const db = mongo.get("leads");

(async () => {
    const leads = await db.find({});

    print(`一共有 ${leads.length} 个 lead 需要被处理`);

    await forEachP(async lead => {
        if (!(lead.contacts?.length > 0)) return;

        const updatedContacts = lead.contacts.filter(contact => contact.deleted_at == null);

        if (updatedContacts.length === lead.contacts.length) return;

        await db.update({_id: lead._id}, {$set: {contacts: updatedContacts}});

        print(`${lead._id} 清理成功`, lead.contacts);
    }, leads);

    print("处理完毕");
})();
