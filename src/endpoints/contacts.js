import {endpoint, protect} from "../lib/api-helper";
import {mongo, id as monkid} from "../lib/db";
import {endpoints} from "../lib/endpoints";

const db = mongo.get("leads");

export const contacts = endpoint(
    {
        add: protect(
            user => user?.access?.leads?.canEditLeads, //edit
            async ({leadId, contact}, {login}) => {
                const finalContact = {_id: monkid(), ...contact};
                const lead = await db.findOneAndUpdate({_id: leadId}, {$push: {contacts: finalContact}});

                endpoints.logs.add({
                    id: lead._id,
                    contactId: finalContact._id,
                    contact: finalContact,
                    type: "lead",
                    event: "contact.add",
                    author: login || "system",
                });

                return lead;
            },
            ["leads"]
        ),

        change: protect(
            user => user?.access?.leads?.canEditLeads, //edit
            async ({contactId, key, val}, {login}) => {
                const oldLead = await db.findOne({"contacts._id": monkid(contactId)}, {projection: {"contacts.$": 1}});
                if (oldLead == null) return;
                const oldContact = oldLead.contacts[0];

                const newLead = await db.findOneAndUpdate({"contacts._id": monkid(contactId)}, {$set: {[`contacts.$.${key}`]: val}});

                if (newLead == null) return null;

                const contact = newLead.contacts.find(contact => contact._id.toString() === contactId);

                endpoints.logs.add({
                    id: newLead._id,
                    type: "lead",
                    event: "contact.change",
                    author: login || "system",
                    contactId,
                    contact,
                    attribute: key,
                    val,
                    oldVal: oldContact[key],
                });

                return contact;
            },
            ["leads"]
        ),

        delete: protect(
            user => user?.access?.leads?.canEditLeads, //edit
            async ({contactId}, {login}) => {
                const lead = await db.findOne({"contacts._id": monkid(contactId)});
                if (lead == null) return null;

                const oldContact = lead.contacts.find(contact => contact._id.toString() === contactId);
                const updatedContacts = lead.contacts.filter(contact => contact._id.toString() !== contactId);

                await db.update(
                    {_id: lead._id},
                    {$set: {contacts: updatedContacts}}
                );

                endpoints.logs.add({
                    id: lead._id,
                    type: "lead",
                    event: "contact.delete",
                    author: login || "system",
                    contactId,
                    contact: oldContact
                });

                return oldContact;
            },
            ["leads"]
        )
    },
    {

    }
);
