import {endpoint, protect} from "../lib/api-helper";
import {mongo} from "../lib/db";
import {endpoints} from "../lib/endpoints";

import dayjs from "dayjs";
import advancedFormat from "dayjs/plugin/advancedFormat";
dayjs.extend(advancedFormat);

const usersDb = mongo.get("users");
const leadsDb = mongo.get("leads");
const invoicesDb = mongo.get("payments");
const invoicesWithLeadsDb = mongo.get("payments_with_leads");
const qcDb = mongo.get("periods");

export const managers = endpoint(
    {
        checkDates: protect(
            async ({arrival, departure, name, email}) => {
                const arr = t => dayjs.unix(t).startOf("day");
                const dep = t => dayjs.unix(t).endOf("day");
                const clientArrival = arr(arrival);
                const clientDeparture = dep(departure);

                const users = await usersDb.find({onlyRussian: false, active: true, group: 0});
                const leads = await leadsDb.find({
                    status_id: {$in: [22115713, 142, 20674288]},
                    manager: {$in: users.map(m => m.manager)},
                });
                const qc = await qcDb.find({
                    end: {$gte: dayjs().unix()},
                    manager: {$in: users.map(m => m.manager)},
                });
                const managers = users.map(user => ({
                    ...user,
                    records: leads.filter(lead => lead.manager === user.login),
                    qc: qc.filter(c => c.manager === user.login),
                }));
                const freeManagers = managers.filter(manager => {
                    const records = manager.records.concat(manager.qc);
                    // eslint-disable-next-line immutable/no-let
                    for (let record of records) {
                        const eventStart = arr(record.arrivalDate || record.start);
                        const eventEnd = dep(record.departureDate || record.end);
                        if (
                            (clientArrival.isBefore(eventStart) && clientDeparture.isAfter(eventStart)) ||
                            (clientArrival.isBefore(eventEnd) && clientDeparture.isAfter(eventEnd)) ||
                            (clientArrival.isAfter(eventStart) && clientDeparture.isBefore(eventEnd))
                        ) {
                            return false;
                        }
                    }
                    return true;
                });

                if (freeManagers.length > 0) {
                    const selectedManager = freeManagers[Math.floor(Math.random() * freeManagers.length)];
                    const invoice = await invoicesDb.insert({
                        name,
                        email,
                        arrival_date: arrival,
                        departure_date: departure,
                        manager: selectedManager.manager,
                        paid: false,
                    });
                    return {
                        invoice: invoice._id,
                        count: freeManagers.length,
                        manager: selectedManager.manager,
                    };
                } else {
                    return {count: 0};
                }
            }
        ),

        payment: protect(
            async ({info, invoice}) => {
                const simpleInvoice = await invoicesDb.findOneAndUpdate({_id: invoice}, {$set: {paid: true, info}});
                const richInvoice = await invoicesWithLeadsDb.findOne({_id: invoice});
                if (richInvoice != null) {
                    endpoints.leads.db.findOneAndUpdate({_id: richInvoice.lead.id});
                }
                const template = await endpoints.emails.getTemplate("Booking confirmation", {
                    from: dayjs.unix(simpleInvoice.arrival_date).format("MMMM Do"),
                    to: dayjs.unix(simpleInvoice.departure_date).format("MMMM Do"),
                    name: simpleInvoice.name,
                });
                endpoints.notifications.sendNotification({
                    title: "New payment",
                    description: `${simpleInvoice.name} has paid through the booking form`,
                    receivers: ["andrei"],
                    priority: "high",
                    lead: richInvoice.lead.id,
                });
                return await endpoints.emails.send(
                    {
                        subject: template.subject,
                        email: richInvoice.lead.email || "faradaytrs@gmail.com",
                        template: template.name,
                        data: template.html,
                    },
                    {},
                );
            }
        ),
    },
    {},
);
