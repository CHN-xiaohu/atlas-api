import {mongo} from "../lib/db"
// import dayjs from "dayjs"

(async () => {
    // const defaultReceipt = {
    //     deposit: 0,
    //     depositForUs: 0,
    //     description: "",
    //     interest: 0,
    //     shippingForUs: 0,
    //     sort: 0
    // }
    const leadsDb = mongo.get('leads');
    const receiptsDb = mongo.get("receipts");
    const leads = await leadsDb.find({
        status_id: {$in: [22115819, 22115719, 142]},
        //orderDate: {$eq: null},
        //arrivalDate: {$eq: null},
        $or: [{orderDate: {$ne: null}}, {arrivalDate: {$ne: null}}],
    });

    const statusMap = {
        22115819: 'shipped',
        22115719: 'production',
        142: 'complete'
    }

    const receipts = await receiptsDb.find({lead: {$in: leads.map(lead => lead._id)}});

    leads.forEach(lead => {
        const leadReceipts = receipts.filter(receipt => receipt.lead.toString() === lead._id.toString())
        leadReceipts.forEach(receipt => {
            if (receipt.status == null) {
                receiptsDb.update({_id: receipt._id}, {$set: {status: statusMap[lead.status_id]}})
            }
            if (receipt.depositDate == null) {
                const depositDate = lead.online ? lead.orderDate : lead.arrivalDate;
                receiptsDb.update({_id: receipt._id}, {$set: {depositDate}});
            }
            if (receipt.confirmDate == null && lead?.confirmedPurchase > 0) {
                const confirmDate = lead.online ? lead.orderDate : lead.arrivalDate;
                receiptsDb.update({_id: receipt._id}, {$set: {confirmDate}})
            }
        })
    })

    // const preLeads = await leadsDb.aggregate([
    //     {$match: {
    //         status_id: {$in: [22115819, 22115719, 142]}
    //     }},
    //     {$lookup: {
    //         from: "receipts",
    //         localField: "_id",
    //         foreignField: "lead",
    //         as: "receipts"
    //     }}
    // ])

    // Promise.all(
    //     preLeads
    //         .filter(lead => (lead.receipts == null || lead.receipts.length === 0))
    //         .map(async lead => {
    //             await receiptsDb.insert({
    //                 ...defaultReceipt,
    //                 lead: lead._id,
    //                 receipt: "Interim receipt",
    //                 sumForClient: lead.confirmedPurchase ?? 0,
    //                 status: statusMap[lead.status_id],
    //                 depositDate: lead.online ? lead.orderDate : lead.arrivalDate,
    //                 created_at: dayjs().toDate(),
    //                 updated_at: dayjs().toDate(),
    //             })
    //         })
    // );

    // console.log(leads);
    // console.log(leads.length, receipts.length);
    // process.exit();
})()
