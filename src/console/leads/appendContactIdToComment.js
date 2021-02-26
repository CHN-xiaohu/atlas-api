import {mongo} from "../../lib/db";
import {forEachP} from "../../helper";

const commentsDb = mongo.get("comments");
const quotationItemsDb = mongo.get("new_quotation_items");
const quotationsDb = mongo.get("new_quotations");
const leadsDb = mongo.get("leads");

(async () => {
    const comments = await commentsDb.find({contactId: {$eq: null}});

    await forEachP(async comment => {
        if (comment.id.toString().includes("-")) return;
        const item = await quotationItemsDb.findOne({_id: comment.id});
        if (item == null) return;
        const quotation = await quotationsDb.findOne({_id: item.quotation});
        const lead = await leadsDb.findOne({_id: quotation.lead});
        const contactId = lead.contacts[0]._id;

        await commentsDb.update({_id: comment._id}, {$set: {contactId}});
    }, comments);

    console.log("执行完毕");
})();
