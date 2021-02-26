import {endpoint, protect, unsafe, client} from "../lib/api-helper";
import {mongo, id as monkid} from "../lib/db";
import {endpoints} from "../lib/endpoints";
import {assoc} from "ramda";
import {whatsapp, information as whatsAppInstances} from "../lib/whatsapp-api";

import dayjs from "dayjs";
import {arrayToString, escapedRegExp, getTaskCompleteTime, message, randomColor} from "../helper";
import os from "os";

const defaults = {
    projection: {
        wechat: 0,
        phone: 0,
        whatsapp: 0,
        email: 0,
        telegram: 0,
        viber: 0,
        contact_name: 0,
    },
};

const limitation = {
    deleted_at: {$exists: false},
};

const db = mongo.get("leads");

const formatValue = (key, value) => {
    if (["orderDate", "arrivalDate", "departureDate", "doNotDisturbTill"].includes(key)) {
        if (value == null) {
            return value;
        }
        return new Date(value);
    }
    return value;
};

export const parseNumber = id => {
    const matches = `${id}`.match(/\d+/);
    if (Array.isArray(matches) && matches.length > 0) {
        return +matches[0];
    }
    return null;
};

const leadsSearchQuery = search => {
    const searchRegex = escapedRegExp(search, "i");
    const number = parseNumber(search);
    return typeof search === "string" && search.length > 0
        ? {
            $or: [
                {managers: {$regex: searchRegex}},
                {_id: {$regex: searchRegex}},
                {"contacts.telegram": {$regex: searchRegex}},
                {"contacts.whatsapp": {$regex: searchRegex}},
                {"contacts.viber": {$regex: searchRegex}},
                {"contacts.contact_name": {$regex: searchRegex}},
                {"contacts.email": {$regex: searchRegex}},
                {country: {$regex: searchRegex}},
                {city: {$regex: searchRegex}},
                {tags: {$regex: searchRegex}},
            ].concat(number == null ? [] : {"contacts.phone": number}),
        }
        : {};
};

const canSeeAllLeadsQuery = user => {
    //console.log(user?.access?.leads?.canSeeAllLeads, user?.access?.leads?.canSeeAllLeads ? {} : {managers: user.login ?? 1})
    return user?.access?.leads?.canSeeAllLeads ? {} : {managers: user?.login ?? 1};
};

const add = async ({status_id = 20674270, responsible = "alena", contacts = [], ...fields}, {login} = {}) => {
    const inserted = await db.insert({
        status_id,
        responsible,
        contacts: contacts.map(contact => assoc("_id", monkid(), contact)),
        ...fields,
        created_at: dayjs().toDate(),
        updated_at: dayjs().toDate(),
    });

    endpoints.logs.add({
        type: "lead",
        event: "add",
        id: inserted._id,
        author: login || "system",
    });

    return inserted;
};

const getLeadByEmail = async ({email}) => {
    return db.findOne({"contacts.email": email});
};

const change = ({lead, key, value}) => {
    const formattedValue = formatValue(key, value);
    return db.findOneAndUpdate({_id: lead}, {$set: {[key]: formattedValue, updated_at: dayjs().toDate()}});
};

const remove = async ({_id}, {login} = {}) => {
    endpoints.logs.add({
        lead: _id,
        type: "lead",
        event: "delete",
        author: login || "system",
    });
    const l = await db.findOneAndUpdate({_id}, {$set: {deleted_at: dayjs().toDate()}});
    endpoints.tasks.db.find({lead: monkid(l._id)}).then(tasks => {
        tasks.forEach(task => {
            endpoints.tasks.delete(task, {login});
        });
    });
    return l;
};

export const leads = endpoint(
    {
        getContacts: client(
            lead => lead != null,
            async (_params, {_id}) => {
                const lead = await db.findOne(
                    {_id},
                    {
                        projection: {
                            "contacts._id": 1,
                            "contacts.contact_name": 1,
                            "contacts.background": 1,
                        },
                    },
                );
                return lead == null ? null : lead.contacts;
            },
        ),

        get: protect(
            user => user?.access?.leads?.canSeeLeads,
            async ({
                skip = defaults.skip,
                limit = defaults.limit,
                sort = defaults.sort,
                projection = defaults.projection,
            }) => {
                const leads = await db.find({...limitation}, {skip, limit, sort, projection});
                return leads;
            },
        ),

        byId: protect(
            user => user?.access?.leads?.canSeeLeads, //see
            async ({_id, ...params}, user) => {
                const lead = await db.findOne(
                    {_id, ...canSeeAllLeadsQuery(user), ...limitation},
                    {...defaults, ...params},
                );
                return lead;
            },
        ),

        findSame: protect(
            user => user?.access?.leads?.canMergeLeads,
            async ({contacts, _id, params}, user) => {
                const leadMessage = ["phone", "whatsapp", "email", "wechat", "viber"];
                const originalLead = contacts.reduce((acc, contact) => {
                    return Object.keys(contact)
                        .filter(
                            key =>
                                !(
                                    (typeof contact[key] === "string" && contact[key].length === 0) ||
                                    contact[key] == null
                                ),
                        )
                        .reduce(
                            (res, key) => ({
                                ...acc,
                                ...res,
                                [key]: [
                                    ...new Set(Array.isArray(acc[key]) ? [...acc[key], contact[key]] : [contact[key]]),
                                ],
                            }),
                            {},
                        );
                }, {});
                const keys = leadMessage.filter(
                    key => Array.isArray(originalLead[key]) && originalLead[key].length > 0,
                );
                if (!Array.isArray(keys) || keys.length === 0) {
                    return null;
                }
                return db.findOne(
                    {
                        _id: {$ne: monkid(_id)},
                        $or: keys.map(key => {
                            return {[`contacts.${key}`]: {$in: originalLead[key]}};
                        }),
                        ...canSeeAllLeadsQuery(user),
                        ...limitation,
                    },
                    {...defaults, ...params},
                );
            },
        ),

        byIds: protect(
            user => user?.access?.leads?.canSeeLeads, //see
            async ({ids, ...params}, user) => {
                if (!Array.isArray(ids)) {
                    return [];
                }
                const leads = await db.find(
                    {
                        _id: {$in: ids.map(id => monkid(id))},
                        ...canSeeAllLeadsQuery(user),
                        ...limitation,
                    },
                    {...defaults, ...params},
                );

                return leads;
            },
        ),

        byPhoneNumbers: protect(
            user => user?.access?.leads?.canSeeLeads,
            async ({numbers, exclude = [], ...params}, user) => {
                if (!Array.isArray(numbers) || numbers.length === 0) {
                    return [];
                }

                const leads = await db.find(
                    {
                        $or: [
                            {"contacts.phone": {$in: numbers}},
                            {"contacts.whatsapp": {$in: numbers}, _id: {$nin: exclude.map(id => monkid(id))}},
                        ],
                        ...canSeeAllLeadsQuery(user),
                        ...limitation,
                    },
                    {...defaults, ...params},
                );

                return leads;
            },
        ),

        byStatus: protect(
            user => user?.access?.leads?.canSeeLeads, //see
            async ({statuses, from, to, country, ...params}, user) => {
                if (statuses == null || !Array.isArray(statuses)) {
                    return [];
                }
                const countryQuery = country == null ? {} : {country};
                const leads = await db.find(
                    {
                        status_id: {$in: statuses},
                        ...countryQuery,
                        $or: [
                            {
                                online: {$ne: true},
                                arrivalDate: {$gte: dayjs(from).toDate()},
                                departureDate: {$lte: dayjs(to).toDate()},
                            },
                            {
                                online: true,
                                orderDate: {$gte: dayjs(from).toDate(), $lte: dayjs(to).toDate()},
                            },
                        ],
                        ...canSeeAllLeadsQuery(user),
                        ...limitation,
                    },
                    {...defaults, ...params},
                );

                return leads;
            },
        ),

        applications: protect(
            user => user?.access?.leads?.canSeeLeads, //see
            async ({statuses, from, to, country, ...params}, user) => {
                if (statuses == null || !Array.isArray(statuses)) {
                    return [];
                }
                const countryQuery = country == null ? {} : {country};
                const leads = await db.find(
                    {
                        status_id: {$in: statuses},
                        created_at: {
                            $gte: dayjs(from).toDate(),
                            $lte: dayjs(to).toDate(),
                        },
                        ...countryQuery,
                        ...canSeeAllLeadsQuery(user),
                        ...limitation,
                    },
                    {...defaults, ...params},
                );

                return leads;
            },
        ),

        scheduledLeads: protect(
            user => user?.access?.leads?.canSeeLeads, //see
            async ({from, to, managers, ...params}, {login, access}) => {
                const managerQuery = !access?.leads?.canSeeAllLeads ? {managers} : {managers: login};

                const leads = await db.find(
                    {
                        $or: [
                            {
                                online: {$ne: true},
                                arrivalDate: {$gte: new Date(from)},
                                departureDate: {$lte: new Date(to)},
                            },
                            {
                                online: true,
                                orderDate: {$gte: new Date(from), $lte: new Date(to)},
                            },
                        ],
                        ...managerQuery,
                        status_id: {
                            $in: [22115719, 22115819, 23674579, 20674288, 21411409, 22115713, 20674273, 22115713, 142],
                        },
                        ...limitation,
                    },
                    {...defaults, ...params},
                );

                return leads;
            },
        ),

        activeLeads: protect(
            user => user?.access?.leads?.canSeeLeads, //see
            async ({search, hideSuspended = false, presence, country, responsible, rating, params, manager}, user) => {
                //, tags, country, city
                const {access} = user;
                const searchQuery = leadsSearchQuery(search);
                const suspendedQuery = hideSuspended
                    ? {
                          $or: [{doNotDisturbTill: {$lte: dayjs().toDate()}}, {doNotDisturbTill: {$eq: null}}],
                      }
                    : {};
                const presenceQuery =
                    presence === "online" ? {online: true} : presence === "personal" ? {online: {$ne: true}} : {};
                const countryQuery =
                    country == null ? {} : country === "noCountry" ? {country: {$exists: false}} : {country};
                const responsibleQuery = responsible == null ? {} : {$or: [{responsible}, {responsible: {$eq: null}}]};
                const ratingQuery =
                    rating == null || rating === 0
                        ? {}
                        : {
                              price: {$gte: [0, 50000, 100000, 200000][rating] * 6.8},
                          };
                const managerQuery =
                    !access?.leads?.canSeeAllLeads || manager == null
                        ? {}
                        : {
                              managers: manager,
                          };
                const leads = await db.find(
                    {
                        status_id: {$nin: [143, 142]},
                        ...suspendedQuery,
                        ...presenceQuery,
                        ...countryQuery,
                        ...responsibleQuery,
                        ...ratingQuery,
                        ...searchQuery,
                        ...managerQuery,
                        ...canSeeAllLeadsQuery(user),
                        ...limitation,
                    },
                    {...defaults, ...params},
                );

                return leads;
            },
        ),

        add: protect(user => user?.access?.leads?.canAddLeads, add, ["leads"]),

        clients: protect(
            user => user?.access?.leads?.canSeeLeads, //see
            async (
                {
                    month,
                    statuses = [
                        142,
                        22115713,
                        20674288,
                        20674270,
                        23674579,
                        20674273,
                        28521454,
                        22115719,
                        22115819,
                        22115713,
                    ],
                    ...params
                },
                user,
            ) => {
                const start = dayjs(month).startOf("month");
                const end = dayjs(month).endOf("month");
                const limitedTimeQuery =
                    month == null
                        ? {}
                        : {
                              $or: [
                                  {
                                      online: {$ne: true},
                                      arrivalDate: {
                                          $gte: start.toDate(),
                                          $lte: end.toDate(),
                                      },
                                  },
                                  {
                                      online: true,
                                      orderDate: {
                                          $gte: start.toDate(),
                                          $lte: end.toDate(),
                                      },
                                  },
                              ],
                          };
                const leads = await db.find(
                    {
                        status_id: {
                            $in: statuses,
                        },
                        ...limitedTimeQuery,
                        ...canSeeAllLeadsQuery(user),
                        ...limitation,
                    },
                    {...defaults, ...params},
                );

                return leads;
            },
        ),

        discarded: protect(
            user => user?.access?.leads?.canSeeLeads, //see
            async ({since, till, search, ...params}) => {
                const leads = await db.find(
                    {
                        status_id: 143,
                        ...(since != null && till != null
                            ? {updated_at: {$gte: new Date(since), $lt: new Date(till)}}
                            : {}),
                        ...leadsSearchQuery(search),
                        ...limitation,
                    },
                    {...defaults, ...params},
                );

                return leads;
            },
        ),

        discardedCount: protect(
            user => user?.access?.leads?.canSeeLeads, //see
            async ({since, till, search, ...params}) => {
                const leadsCount = await db.count(
                    {
                        status_id: 143,
                        ...(since != null && till != null
                            ? {updated_at: {$gte: new Date(since), $lt: new Date(till)}}
                            : {}),
                        ...leadsSearchQuery(search),
                        ...limitation,
                    },
                    {...defaults, ...params},
                );

                return leadsCount;
            },
        ),

        merge: protect(
            user => user?.access?.leads?.canMergeLeads, //merge
            async ({from, to}, user) => {
                const source = await db.findOne({_id: from});
                const target = await db.findOne({_id: to});
                const {login} = user;

                if (source == null || target == null) {
                    return null;
                }
                const mergingTasks = endpoints.tasks.db.update(
                    {lead: monkid(source._id)},
                    {$set: {lead: monkid(target._id)}},
                    {multi: true},
                );
                const mergingNotes = endpoints.notes.db.update(
                    {lead: monkid(source._id)},
                    {$set: {lead: monkid(target._id)}},
                    {multi: true},
                );
                const mergingLogs = endpoints.logs.db.update(
                    {lead: monkid(source._id)},
                    {$set: {lead: monkid(target._id)}},
                    {multi: true},
                );
                const mergingReceipts = endpoints.receipts.db.update(
                    {lead: monkid(source._id)},
                    {$set: {lead: monkid(target._id)}},
                    {multi: true},
                );
                const mergingQuotations = endpoints.newQuotations.db.update(
                    {lead: monkid(source._id)},
                    {$set: {lead: monkid(target._id)}},
                    {multi: true},
                );
                const patch = Object.keys(source).reduce((patch, field) => {
                    if (
                        (target[field] == null || (typeof target[field] === "string" && target[field].length === 0)) &&
                        (source[field] != null || (typeof source[field] === "string" && source[field].length !== 0))
                    ) {
                        patch[field] = source[field];
                    } else if (
                        (target[field] && target[field]) != null &&
                        Array.isArray(target[field] && target[field])
                    ) {
                        patch[field] = target[field].concat(source[field]);
                    }
                    return patch;
                }, {});
                const changingProperties =
                    Object.keys(patch).length === 0 ? target : db.findOneAndUpdate({_id: to}, {$set: patch});
                remove(source, user);
                const addLogs = endpoints.logs.add({
                    type: "lead",
                    id: monkid(target._id),
                    event: "merge",
                    patch,
                    source: source._id,
                    target: target._id,
                    author: login || "system",
                });
                Promise.all([
                    mergingTasks,
                    mergingNotes,
                    mergingLogs,
                    mergingReceipts,
                    mergingQuotations,
                    changingProperties,
                    addLogs,
                ]);
                return changingProperties;
            },
            ["leads"],
        ),

        remove: protect(
            user => user?.access?.leads?.canDeleteLeads, //delete
            remove,
            ["leads"],
        ),

        change: protect(
            user => user?.access?.leads?.canEditLeads, //edit
            async ({lead, key, value}, user) => {
                if (key.startsWith("contacts")) return null;

                //write log
                const {login} = user;
                const oldLead = await db.findOne({_id: lead});

                //console.log(key, formattedValue, formattedValue instanceof Date);

                //canChangeResponsible
                if (key === "responsible") {
                    if (!user?.access?.leads?.canChangeResponsible) {
                        return;
                    } else {
                        endpoints.tasks.db.find({status: false, lead: monkid(lead)}).then(activeTasks => {
                            activeTasks.forEach(task =>
                                endpoints.tasks.reassign({_id: task._id, responsible: value}, user),
                            );
                        });
                    }
                }

                if (key === "managers" && !user?.access?.leads?.canChangeManagers) {
                    return;
                }

                endpoints.logs.add({
                    id: monkid(lead),
                    type: "lead",
                    event: "change",
                    field: key,
                    newValue: value,
                    oldValue: oldLead[key],
                    author: login || "system",
                });

                const finalValue =
                    key === "contacts"
                        ? value.map(contact => (contact._id == null ? assoc("_id", monkid(), contact) : contact))
                        : value;

                return change({
                    lead,
                    key,
                    value: finalValue,
                });
            },
            ["leads"],
        ),

        confirmPurchase: protect(
            user => user?.access?.leads?.canConfirmPurchaseLeads, //confirmPurchase
            ({lead, purchase}) => {
                //TODO add log
                return db.findOneAndUpdate(
                    {_id: lead},
                    {
                        $set: {
                            confirmedPurchase: purchase,
                            updated_at: dayjs().toDate(),
                        },
                    },
                );
            },
            ["leads"],
        ),

        getLeadByEmail: protect(
            user => user?.access?.leads?.canSeeLeads, //see
            getLeadByEmail,
        ),

        newLead: protect(
            _user => true,
            props => {
                console.log(props);
                return endpoints.leads.hook(props);
            },
        ),
        checkWhatsapp: protect(
            user => user?.access?.leads?.canSeeLeads,
            async ({phone}) => {
                const checks = await Promise.all(
                    Object
                        .keys(whatsAppInstances)
                        .map(async instance => {
                            const {result} = await whatsapp.request(instance, "/checkPhone", {phone});
                            return result === "exists";
                        })
                )
                return checks.includes(true);
            }
        )
    },
    {
        db,

        remove: unsafe(remove, ["leads"]),

        byPhoneNumbers: async ({numbers, exclude = [], ...params}) => {
            if (!Array.isArray(numbers) || numbers.length === 0) {
                return [];
            }

            return db.find(
                {
                    $or: [
                        {phone: {$in: numbers}},
                        {whatsapp: {$in: numbers}, _id: {$nin: exclude.map(id => monkid(id))}},
                    ],
                    ...limitation,
                },
                {...defaults, ...params},
            );
        },

        byEmail: async ({email, ...params}, user) => {
            return db.findOne({email, ...canSeeAllLeadsQuery(user), ...limitation}, {...defaults, ...params});
        },

        add: unsafe(add, ["leads"]),
        change: unsafe(change, ["leads"]),
        getLeadByEmail,

        checkClient: userId => {
            if (typeof userId !== "string" || userId.length !== 24) {
                return null;
            }
            return db.findOne({_id: monkid(userId)});
        },

        messagesToText: messages => {
            return messages
                .map(message => {
                    const author = message.type === "visitor" ? "Клиент" : "Менеджер";
                    return `[${author}]: ${message.message}`;
                })
                .join(os.EOL);
        },
        hook: unsafe(
            async ({
                name,
                email,
                connect,
                phone,
                propertyType,
                area,
                metering,
                budget,
                city,
                details,
                source = "",
                russian = false,
            }) => {
                //TODO simplify to just adding lead to database

                if (typeof email === "string" && email.length > 0 && (await endpoints.leads.db.count({email})) > 0) {
                    console.log("[website hook]", email, "already exists");
                    // add note with messages
                    const lead = await getLeadByEmail({email});
                    if (lead != null) {
                        change({
                            lead: lead._id,
                            key: "status_id",
                            value: 20674270,
                        });
                        endpoints.notes.add(
                            {
                                lead: lead._id,
                                type: "text",
                                text: message({
                                    "Повторная заявка": "",
                                    Сообщение: details,
                                    Местоположение: city,
                                    "Со страницы": source,
                                    "Хочет общаться через": connect,
                                    Номер: phone,
                                    "Мебель для": `${propertyType} ${area}${metering}^2`,
                                    Бюджет: budget,
                                }),
                            },
                            {login: "system"},
                        );
                        return {result: "User with such email already exists in the system"};
                    } else return {result: "Found contact, but couldn't find a lead"};
                } else {
                    //add lead to the system
                    console.log("[website hook]", email ?? phone, "to be added to the system");
                    const language = source.includes("world") || source.includes("ru") ? "ru" : "en";
                    if (email != null) {
                        endpoints.emails.autoresponse({
                            language,
                            name: name || (language === "ru" ? "Клиент" : "Client"),
                            email,
                        });
                    }
                    console.log("[website hook]", "passed autoresponse stage, about to add new lead");
                    const lead = await add(
                        {
                            name: arrayToString([name, city]),
                            price: budget && Math.floor(parseInt(budget.replace(/\s/g, "")) * 7.05),
                            source,
                            russianSpeaking: language === "ru" ?? russian,
                            provideCustoms: language === "ru",
                            autogenerated: true,
                            connection: connect,
                            propertySize: metering === "m" || metering === "м" ? area : Math.floor(area / 10.764),
                            propertyType,
                            contacts: [
                                {
                                    _id: monkid(),
                                    contact_name: name,
                                    phone: +phone?.replace(/\D/g, ""),
                                    email,
                                    background: randomColor(),
                                },
                            ],
                        },
                        {login: "system"},
                    );
                    console.log("[website hook]", "lead added", lead._id);
                    endpoints.notes.add(
                        {
                            lead: lead._id,
                            type: "text",
                            text: message({
                                Сообщение: details,
                                Местоположение: city,
                                "Со страницы": source,
                                "Хочет общаться через": connect,
                                Номер: phone,
                                "Мебель для": `${propertyType} ${area}${metering}^2`,
                                Бюджет: budget,
                            }),
                        },
                        {login: "system"},
                    );
                    endpoints.tasks.add(
                        {
                            lead: lead._id,
                            completeTill: getTaskCompleteTime(dayjs(), "high"),
                            priority: "high",
                            text: "Новая заявка, нужно связаться с клиентом",
                        },
                        {login: "system"},
                    );
                    endpoints.notifications.sendNotification({
                        title: `New client from ${source}`,
                        description: `${name}`,
                        receivers: ["alena", "andrei"],
                        priority: "high",
                        lead: lead._id,
                    });
                    return {result: "ok"};
                }
            },
            ["leads"],
        ),
    },
);

// db.find({}).then(leads => {
//     console.log(
//         JSON.stringify(
//             leads
//                 .map(lead => lead.contacts)
//                 .flat()
//                 .filter(
//                     contact =>
//                         (contact.phone ?? contact.whatsapp) != null &&
//                         (contact.phone ?? contact.whatsapp).toString().startsWith("79"),
//                 )
//                 .map(contact => +(contact.phone ?? contact.whatsapp)),
//                 null,
//                 4
//         ),
//     );
// })
