import {client, endpoint, protect, unsafe} from "../lib/api-helper";
import {id as monkid, mongo} from "../lib/db";
import {endpoints} from "../lib/endpoints";
import {contactName} from "../helper";

import dayjs from "dayjs";
import {assoc} from "ramda";
import {io} from "../lib/sockets";

const db = mongo.get("comments");
const quotationItemsDb = mongo.get("new_quotation_items");
const quotationsDb = mongo.get("new_quotations");
const leadsDb = mongo.get("leads");

const limitation = {};

const defaults = {
    skip: 0,
    limit: 0,
    projection: {},
};

const markASRead = async ({ids}, {login}) => {
    await db.update(
        {
            readBy: {$ne: login ?? "client"},
            _id: {$in: ids.map(id => monkid(id))},
        },

        {$push: {readBy: login ?? "client"}},
        {multi: true},
    );
};

const unread = async ({ids}, {login}) => {
    const preparedIds = ids.map(id => [monkid(id), id?.toString()]).flat();
    const messages = await db.find(
        {id: {$in: preparedIds}, readBy: {$ne: login ?? "client"}},
        {projection: {id: 1, readBy: 1}},
    );
    return ids.reduce((acc, id) => {
        acc[id] = messages.filter(message => message.id.toString() === id.toString()).length;
        return acc;
    }, {});
};

const add = async (
    {queueId, id, text, imageId, fileId, fileName, fileSize, type = "text", meta, contactId, leadId},
    {login},
) => {
    const message = await db.insert({
        queueId,
        id,
        author: login ?? "client",
        time: dayjs().toDate(),
        text,
        imageId,
        fileId,
        fileName,
        fileSize,
        type,
        meta,
        readBy: [contactId ?? login],
        contactId,
    });
    if (leadId != null) {
        io.to(leadId.toString()).emit("newMessage", message);
    } else {
        const quotationItem = await quotationItemsDb.findOne({_id: monkid(id)});
        if (quotationItem != null) {
            const quotation = await quotationsDb.findOne({_id: monkid(quotationItem.quotation)});
            io.to(quotation.lead.toString()).emit("newMessage", message);
        } else {
            io.to(id.toString()).emit("newMessage", message);
        }
    }
    return message;
};

export const comments = endpoint(
    {
        byId: protect(
            user => user?.access?.products?.canSeeComments,
            async ({id, ...params}) => {
                return db.find({id}, {...defaults, ...params});
            },
        ),

        byIds: protect(
            user => user?.access?.products?.canSeeComments,
            async ({id, instance, page = 1, limit = 100, ...params}) => {
                const currentPage = parseInt(page);
                const options = {
                    ...defaults,
                    ...params,
                    skip: (currentPage - 1) * limit,
                    limit,
                    sort: {
                        time: -1,
                    },
                };
                const comments = await db.find({id}, options);
                const contactIds = [
                    ...new Set(
                        comments
                            .map(comment => (comment.author === "client" ? comment?.contactId?.toString() : null))
                            .filter(id => id != null),
                    ),
                ].map(id => monkid(id));

                const leads = await leadsDb.find({"contacts._id": {$in: contactIds}});

                const contactMap = leads
                    .map(lead => lead.contacts)
                    .flat()
                    .reduce((acc, contact) => assoc(contact._id, contact, acc), {});

                const finalComments = comments.map(comment =>
                    comment.author === "client" ? assoc("contact", contactMap[comment.contactId], comment) : comment,
                );

                const nextPage =
                    (await db.count({id}, {...options, skip: options.skip + limit, limit: 1})) > 0
                        ? currentPage + 1
                        : null;
                return {data: finalComments, nextPage};
            },
        ),

        forClient: client(
            lead => lead != null,
            async ({ids, page = 1, ...params}) => {
                if (!Array.isArray(ids) || ids.length === 0) {
                    return [];
                }

                const limit = 100;
                const finalPage = parseInt(page);
                const options = {...params, skip: (finalPage - 1) * limit, limit, sort: {_id: -1}};
                const comments = await db.find({id: {$in: ids}}, options);
                const nextPage =
                    (await db.count({id: {$in: ids}}, {...options, skip: finalPage * limit, limit: 1})) > 0
                        ? finalPage + 1
                        : null;
                const authors = [...new Set(comments.map(({author}) => author))];
                const users = await endpoints.users.db.find(
                    {login: {$in: authors}},
                    {
                        projection: {
                            avatar: 1,
                            login: 1,
                            name: 1,
                            shortName: 1,
                            _id: 1,
                        },
                    },
                );

                return {
                    users,
                    data: comments,
                    nextPage,
                };
            },
        ),

        theLastCommentForClient: client(
            lead => lead != null,
            async ({quotationId, leadId}) => {
                const quotationItems = await quotationItemsDb.find(
                    {quotation: monkid(quotationId), ...endpoints.newQuotationItems.limitation},
                    {projection: {_id: 1}},
                );

                const result = await Promise.all(
                    quotationItems
                        .map(({_id}) => _id.toString())
                        .concat(leadId)
                        .map(async id => {
                            return {
                                id,
                                comment: await db.findOne({id}, {sort: {_id: -1}}),
                            };
                        }),
                );

                return result.reduce((acc, item) => {
                    return {
                        ...acc,
                        [item.id]: item.comment,
                    };
                }, {});
            },
        ),

        add: protect(user => user?.access?.products?.canAddComments, add, ["comments"]),

        addAndNotify: client(
            lead => lead != null,
            async ({queueId, id, text, imageId, fileId, fileName, fileSize, type = "text", meta, contactId}, {_id}) => {
                const quotationItem = await quotationItemsDb.findOne({_id: monkid(id)});

                if (quotationItem == null) {
                    const lead = await leadsDb.findOne(
                        {"contacts._id": monkid(contactId)},
                        {projection: {"contacts.$": 1}},
                    );

                    if (lead == null) return null;
                    add(
                        {queueId, id, text, imageId, fileId, fileName, fileSize, type, meta, contactId, leadId: _id},
                        {},
                    );
                    const contact = lead.contacts?.[0];
                    const goTo = `https://atlas.globus.furniture/leads/${_id}`;
                    endpoints.notifications.sendNotification({
                        description:
                            type === "text"
                                ? `<a href="${goTo}">${contactName(
                                      contact,
                                  )}</a> sent you a new message: ${text} <a href="${goTo}">点击跳转</a>`
                                : type === "image"
                                ? `<a href="${goTo}">${contactName(
                                      contact,
                                  )}</a> sent you a new picture <a href="${goTo}">点击跳转</a>`
                                : type === "file"
                                ? `<a href="${goTo}">${contactName(
                                      contact,
                                  )}</a> sent you a new file <a href="${goTo}">点击跳转</a>`
                                : `<a href="${goTo}">${contactName(
                                      contact,
                                  )}</a> sent you a new message <a href="${goTo}">点击跳转</a>`,
                        receivers: [lead.responsible],
                    });
                } else {
                    add(
                        {queueId, id, text, imageId, fileId, fileName, fileSize, type, meta, contactId, leadId: _id},
                        {},
                    );
                    const quotation = await quotationsDb.findOne({_id: quotationItem.quotation});
                    const goTo = `https://atlas.globus.furniture/leads/${_id}/new_quotations/${quotation._id}/${quotationItem._id}`;
                    endpoints.notifications.sendNotification({
                        description:
                            type === "text"
                                ? `The client in <a href="${goTo}">${quotationItem.name}</a> from <a href="${goTo}">${quotation.name}</a> sent you a new message: ${text} <a href="${goTo}">点击跳转</a>`
                                : type === "image"
                                ? `The client in <a href="${goTo}">${quotationItem.name}</a> from <a href="${goTo}">${quotation.name}</a> sent you a new picture <a href="${goTo}">点击跳转</a>`
                                : type === "file"
                                ? `The client in <a href="${goTo}">${quotationItem.name}</a> from <a href="${goTo}">${quotation.name}</a> sent you a new file <a href="${goTo}">点击跳转</a>`
                                : `The client in <a href="${goTo}">${quotationItem.name}</a> from <a href="${goTo}">${quotation.name}</a> sent you a new message <a href="${goTo}">点击跳转</a>`,
                        receivers: quotation.responsibles,
                    });
                }
            },
            ["comments"],
        ),

        markASRead: protect(user => user?.access?.products?.canSeeComments, markASRead, ["comments"]),

        markASReadForClient: client(
            lead => lead != null,
            async ({commentIds, contactId}) => {
                await markASRead({ids: commentIds}, {login: contactId});
            },
            ["comments"],
        ),

        unread: protect(
            user => user?.access?.products?.canSeeComments,
            async ({quotationId, leadId}, {login}) => {
                const quotationItems = await quotationItemsDb.find(
                    {
                        quotation: monkid(quotationId),
                        ...endpoints.newQuotationItems.limitation,
                    },
                    {projection: {_id: 1}},
                );
                const ids = quotationItems.map(({_id}) => _id).concat(leadId);
                return unread({ids}, {login});
            },
        ),

        unreadForClient: client(
            lead => lead != null,
            async ({quotationId, contactId}, {_id: leadId}) => {
                const quotationItems = await quotationItemsDb.find(
                    {
                        quotation: monkid(quotationId),
                        ...endpoints.newQuotationItems.limitation,
                    },
                    {projection: {_id: 1}},
                );
                const ids = quotationItems.map(({_id}) => _id).concat(leadId);
                return unread({ids}, {login: contactId});
            },
        ),

        unreadForQuotations: protect(
            user => user?.access?.products?.canSeeComments,
            async ({quotationIds}, {login}) => {
                const quotationItems = await quotationItemsDb.find({
                    quotation: {$in: quotationIds.map(id => monkid(id))},
                    ...limitation,
                });
                const quotationItemUnreadCounts = await unread(
                    {ids: quotationItems.map(quotationItem => quotationItem._id.toString())},
                    {login},
                );

                return quotationIds.reduce((acc, quotationId) => {
                    const items = quotationItems.filter(item => item.quotation.toString() === quotationId);
                    acc[quotationId] = items
                        .map(item => quotationItemUnreadCounts[item._id])
                        .reduce((total, count) => total + count, 0);
                    return acc;
                }, {});
            },
        ),

        delete: protect(
            user => user?.access?.products?.canDeleteClientMessages,
            ({_id}) => {
                return db.findOneAndDelete({_id});
            },
            ["comments"],
        ),
    },
    {
        db,
        unreadMultiple: unsafe(async ({quotationIds, leadId}, {login}) => {
            const quotationItems = await quotationItemsDb.find(
                {
                    quotation: {$in: quotationIds.map(quotationId => monkid(quotationId))},
                    ...endpoints.newQuotationItems.limitation,
                },
                {projection: {_id: 1}},
            );
            const itemsIds = quotationItems.map(({_id}) => _id);
            const ids = leadId == null ? itemsIds : itemsIds.concat(leadId);
            return unread({ids}, {login});
        }),
    },
);
