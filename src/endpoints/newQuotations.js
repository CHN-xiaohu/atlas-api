import axios from "axios";
import dayjs from "dayjs";
import Excel from "exceljs";
import sharp from "sharp";
import {escapedRegExp, idRegex} from "../helper";
import {advancedResponse, client, endpoint, protect} from "../lib/api-helper";
import {id as monkid, mongo} from "../lib/db";
import {endpoints} from "../lib/endpoints";
import {forex} from "../lib/forex";
import {forEachP} from "../helper";

const LANGUAGE_RU = "ru";
const LANGUAGE_EN = "en";
//const LANGUAGE_ZH = "zh";

const DICTIONARY = {
    [LANGUAGE_EN]: {
        Number: "Number",
        Photo: "Photo",
        Item: "Item",
        "Item ID": "Item ID",
        Characteristics: "Characteristics",
        Description: "Description",
        Price: "Price",
        Volume: "Volume",
        Weight: "Weight",
        Amount: "Amount",
        Manager: "Manager",
        Client: "Client",
        Contacts: "Contacts",
        "Estimated quotation": "Estimated quotation",
        "Creation date": "Creation date",
    },

    [LANGUAGE_RU]: {
        Number: "Номер",
        Photo: "Фотография",
        Item: "Название",
        "Item ID": "Артикул",
        Characteristics: "Характеристики",
        Description: "Комментарий",
        Price: "Цена",
        Volume: "Объем",
        Weight: "Вес",
        Amount: "Количество",
        Manager: "Менеджер",
        Client: "Клиент",
        Contacts: "Контакты",
        "Estimated quotation": "Предварительный расчет",
        "Creation date": "Дата формирования",
    },
};

const translate = (language, key) => {
    return DICTIONARY?.[language]?.[key] ?? key;
};

const roboto = {
    name: "Roboto",
    size: 19,
};

const bluePattern = {
    type: "pattern",
    pattern: "solid",
    bgColor: {argb: "FFCFE2F3"},
    fgColor: {argb: "FFCFE2F3"},
};

const limitation = {
    deleted_at: {$eq: null},
};

const db = mongo.get("new_quotations");
const quotationItemsDb = mongo.get("new_quotation_items");
const receiptsDb = mongo.get("receipts");
const purchasesDb = mongo.get("new_purchases");
const leadsDb = mongo.get("leads");
const statusesDb = mongo.get("pipelines_with_leads");
const suppliersDb = mongo.get("suppliers");

export const finalPrice = (price, interest = 0.3, shipping) => Math.ceil(price / (1 - interest) + (shipping ?? 0));

const canEditResponsibles = async (_id, user) => {
    if (user?.access?.products?.canEditAllQuotations) return true;
    const quotation = await db.findOne({_id, ...limitation});
    return quotation.author === user.login;
};

const addHeader = async (workbook, sheet, language = "en", client) => {
    const logo = await workbook.addImage({
        filename: "/var/www/html/files/logo.png",
        extension: "png",
    });

    sheet.getCell("A1").value = "";
    const width = 4429;
    const height = 1259;
    const logoWidth = 450;
    const logoHeight = logoWidth / (width / height);
    sheet.addImage(logo, {
        tl: {col: 0.2, row: 0.4},
        ext: {width: logoWidth, height: logoHeight},
        editAs: "oneCell",
        //hyperlinks: {hyperlink: language === "ru" ? "https://globus.world" : "https://globus-china.com"},
    });
    sheet.mergeCells("A1", "J1");
    //title
    sheet.getCell("A1").value = translate(language, "Estimated quotation");
    sheet.getCell("A1").style.font = {
        name: "Comfortaa",
        size: 45,
    };
    sheet.getRow(1).height = 85;
    //info
    sheet.mergeCells("A2", "D2");
    //manager
    const name = language === "ru" ? "Мария" : "Maria";
    sheet.getCell("A2").value = `${translate(language, "Manager")}: ${name}`;
    sheet.getCell("A2").style.font = roboto;
    sheet.getCell("A2").style.fill = bluePattern;
    sheet.mergeCells("E2", "J2");
    //creation date
    const date = dayjs().format("DD.MM.YYYY HH:mm");
    sheet.getCell("E2").value = `${translate(language, "Client")}: ${client}`;
    sheet.getCell("E2").style.font = roboto;
    sheet.getCell("E2").style.fill = bluePattern;
    sheet.getRow(2).height = 30;
    sheet.mergeCells("A3", "D3");
    sheet.mergeCells("E3", "J3");
    sheet.getCell("A3").style.font = roboto;
    sheet.getCell("A3").style.fill = bluePattern;
    sheet.getCell("A3").value = `WhatsApp / Email: +8618675762020`;
    sheet.getCell("E3").style.font = roboto;
    sheet.getCell("E3").style.fill = bluePattern;
    sheet.getCell("E3").value = `${translate(language, "Creation date")}: ${date}`;
    sheet.getRow(3).height = 30;
};

const defineColumns = (sheet, columnMetas) => {
    sheet.columns = columnMetas.map(({header, ...column}) => column);
};

const addTableTitle = (sheet, columnMetas, rowIndex) => {
    sheet.getRow(rowIndex).values = columnMetas.map(column => column.header);
};

const addTableBody = (sheet, quotation, forex) => {
    sheet.addRows(
        quotation.items.map((item, index) => {
            const finalInterest = item?.interest ?? 0.3;
            const itemFinalPrice = finalPrice(item.price, finalInterest, item?.shipping ?? 0);
            return {
                n: index + 1,
                itemId: item.itemId,
                item: item.name,
                quantity: item.quantity ?? 1,
                characteristics: item.characteristics,
                description: item.description,
                price: `${itemFinalPrice}¥ (${Math.ceil(itemFinalPrice / forex)}$)`,
                weight: item.weight != null ? `${item.weight}kg` : "-",
                volume: item.volume != null ? `${item.volume}m3` : "-",
            };
        }),
    );
};

const addImagesIntoTableBody = async (workbook, sheet, quotation, beginBodyRowIndex) => {
    const loadPreviewPromises = quotation.items.map((item, index) => {
        return (async () => {
            try {
                if (item.photos.length <= 0) return null;
                const photoSource = item.preview ?? item.photos[0];
                const isNew = !photoSource.startsWith("http");

                // eslint-disable-next-line immutable/no-let
                let preview, width, height;
                if (isNew) {
                    const image = await endpoints.images.get({photo: photoSource + "|original"});
                    const imageBuffer = await axios
                        .get(image.link, {responseType: "arraybuffer"})
                        .then(response => Buffer.from(response.data, "binary"));
                    const metadata = await sharp(imageBuffer).metadata();
                    width = metadata.width;
                    height = metadata.height;
                    preview = await workbook.addImage({buffer: imageBuffer, extension: "png"});
                } else {
                    const url = photoSource;
                    const file = await endpoints.files.db.findOne({url});
                    const pathOnDisk = file.pathOnDisk;
                    width = file.width;
                    height = file.height;
                    preview = await workbook.addImage({
                        buffer: await sharp(pathOnDisk)
                            .resize(399, null, {fit: "inside", withoutEnlargement: true})
                            .png()
                            .toBuffer(),
                        extension: "png",
                    });
                }

                return {index, preview, width, height};
            } catch (e) {
                console.log(e, item);
            }
        })();
    });

    const fitTo = 399;
    const previews = await Promise.all(loadPreviewPromises);
    const filteredPreviews = previews.filter(preview => preview != null);

    filteredPreviews.forEach(({index, preview, width, height}) => {
        sheet.addImage(preview, {
            tl: {col: 2.01, row: index + beginBodyRowIndex - 1 + 0.1},
            ext: {width: fitTo, height: height / (width / fitTo)},
            editAs: "oneCell",
        });
    });

    return filteredPreviews.reduce((desiredRowHeights, {index, width, height}) => {
        desiredRowHeights[index + beginBodyRowIndex] = height / (width / fitTo) / 1.76;
        return desiredRowHeights;
    }, []);
};

const addFooter = (sheet, language) => {
    const row = sheet.rowCount + 1;
    sheet.mergeCells(`A${row}`, `I${row}`);
    sheet.getCell(`A${row}`).value =
        language === "ru"
            ? "Внимание: этот документ является предварительным расчетом, фактические (итоговые) цены на товары могут отличаться от цен, указанных в этом документе! Так происходит по причине того, что на большую часть товаров у нас уже созданы карточки с ценами и характеристиками. Например, мы создали карточку товара на определенный диван в марте 2020 года, в июле 2020 года мы использовали эту карточку для формирования предварительного расчета клиентам, но в июне 2020 года поставщик сделал наценку на всю мебель в размере 10% - соответственно цена на товар выросла. Поэтому на некоторые товары цена может меняться. При итоговом расчете мы запрашиваем 100% актуальную информацию у поставщиков и указываем финальные цены, которые не изменяются на момент оплаты."
            : "Attention: this document is an estimated calculation, actual prices for goods may differ from the prices indicated in this quote! The quotation is based on the previous orders and characteristics. Actual price may change due to quantity, upholstery choice, price for raw materials etc. We request actual prices for the chosen quality, quantity for each client after signing the contract.";
    sheet.getCell(`A${row}`).style.font = {
        ...roboto,
        color: {argb: "FFFF0000"},
    };
    sheet.getCell(`A${row}`).border = {
        top: {style: "thick", color: {argb: "FFFF0000"}},
        left: {style: "thick", color: {argb: "FFFF0000"}},
        bottom: {style: "thick", color: {argb: "FFFF0000"}},
        right: {style: "thick", color: {argb: "FFFF0000"}},
    };

    sheet.getRow(row).height = 75;
};

const handleAddPurchases = async ({receipt, quotation, product = "", item, amount, description, photo = [], shipping = 0, price, interest, comment, lead}) => {
    return purchasesDb.insert({
        amount,
        customs: "",
        description,
        item,
        material: "",
        netWeight: 0,
        packages: 0,
        photo,
        tradeMark: "",
        volume: 0,
        weight: 0,
        receipt,
        quotation,
        product,
        lead,
        price,
        interest,
        comment,
        shipping,
        created_at: dayjs().toDate(),
        updated_at: dayjs().toDate(),
    });
};

export const newQuotations = endpoint(
    {
        all: protect(
            user => user?.access?.products?.canSeeQuotations, // see
            async ({skip = 0, limit = 10}) => {
                return db.aggregate([
                    {
                        $match: {
                            ...limitation,
                        },
                    },
                    {
                        $sort: {
                            created_at: -1,
                        },
                    },
                    {
                        $skip: skip,
                    },
                    {
                        $limit: limit,
                    },
                    {
                        $lookup: {
                            from: "new_quotation_items",
                            localField: "_id",
                            foreignField: "quotation",
                            as: "items",
                        },
                    },
                    {
                        $set: {
                            itemCount: {
                                $size: {
                                    $filter: {
                                        input: "$items",
                                        as: "item",
                                        cond: {
                                            $or: [
                                                {$eq: [{$type: "$$item.deleted_at"}, "missing"]},
                                                {$eq: ["$$item.deleted_at", null]},
                                            ],
                                        },
                                    },
                                },
                            },
                        },
                    },
                    {
                        $project: {
                            items: 0,
                        },
                    },
                ]);
            },
        ),

        count: protect(
            user => user?.access?.products?.canSeeQuotations, // see
            async () => {
                return db.count({...limitation});
            },
        ),

        forLeads: protect(
            user => user?.access?.products?.canSeeQuotations, // see
            async ({leadIds}) => {
                return db.aggregate([
                    {
                        $match: {
                            lead: {
                                $in: leadIds.map(id => monkid(id)),
                            },
                            ...limitation,
                        },
                    },
                    {
                        $lookup: {
                            from: "new_quotation_items",
                            localField: "_id",
                            foreignField: "quotation",
                            as: "items",
                        },
                    },
                    {
                        $set: {
                            itemCount: {
                                $size: {
                                    $filter: {
                                        input: "$items",
                                        as: "item",
                                        cond: {
                                            $or: [
                                                {$eq: [{$type: "$$item.deleted_at"}, "missing"]},
                                                {$eq: ["$$item.deleted_at", null]},
                                            ],
                                        },
                                    },
                                },
                            },
                        },
                    },
                    {
                        $project: {
                            items: 0,
                        },
                    },
                    {
                        $sort: {
                            created_at: -1,
                        },
                    },
                ]);
            },
        ),

        byId: protect(
            user => user?.access?.products?.canSeeQuotations, //see
            async ({_id}) => {
                const quotation = await db.findOne({_id, ...limitation});
                if (quotation === null) return null;
                quotation.itemCount = await quotationItemsDb.count({quotation: monkid(_id), ...limitation});
                return quotation;
            },
        ),

        byIdForClient: client(
            lead => lead != null,
            async ({_id}) => db.findOne({_id, ...limitation}),
        ),

        add: protect(
            user => user?.access?.products?.canAddQuotations, // add
            async ({lead, ...data}, {login}) => {
                const author = login || "system";

                const quotation = await db.insert({
                    ...data,
                    lead: monkid(lead),
                    author: login,
                    created_at: dayjs().toDate(),
                    updated_at: dayjs().toDate(),
                    deleted_at: null,
                });

                endpoints.logs.add({
                    id: quotation._id,
                    type: "quotation",
                    event: "add",
                    author,
                });

                return quotation;
            },
            ["newQuotations"],
        ),

        update: protect(
            user => user?.access?.products?.canEditQuotations, // edit
            async ({_id, key, val}, user) => {
                const {login} = user;
                const author = login || "system";

                if (key === "responsibles" && !(await canEditResponsibles(_id, user))) return null;

                const quotation = await db.findOneAndUpdate(
                    {_id, ...limitation},
                    {
                        $set: {
                            [key]: val,
                            updated_at: dayjs().toDate(),
                        },
                    },
                );

                if (quotation == null) return;

                endpoints.logs.add({
                    id: quotation._id,
                    type: "quotation",
                    event: "update",
                    author,
                });

                return quotation;
            },
            ["newQuotations"],
        ),

        addPurchasesById: protect(
            user => user?.access?.leads?.canAddPurchases, // delete
            async ({ids = [], leadId, quotationId}) => {
                const quotationItems = await quotationItemsDb.find({
                    _id: {$in: ids.map(id => monkid(id))},
                    ...limitation,
                });

                await forEachP(async item => {
                    const result = await receiptsDb.findOne({
                        lead: monkid(leadId),
                        supplier: monkid(item.supplier),
                        status: "selection",
                        ...limitation,
                    });
                    if (result != null) {
                        await handleAddPurchases({
                            receipt: result._id,
                            item: item.name,
                            amount: item?.quantity ?? 1,
                            photo: item?.photos ?? [],
                            description: item?.characteristics,
                            lead: leadId,
                            quotation: monkid(quotationId),
                            product: item.product != null && monkid(item.product),
                            price: item?.price,
                            interest: item?.interest,
                            comment: item?.description,
                            shipping: item?.shipping ?? 0,
                        });
                        const itemPriceForClient = finalPrice(item.price, item?.interest ?? 0.3);
                        await receiptsDb.update(
                            {
                                _id: result._id,
                            },
                            {
                                $set: {
                                    sumForClient: (itemPriceForClient + (item?.shipping ?? 0)) * (item?.quantity ?? 1) + result.sumForClient,
                                    interest:
                                        (itemPriceForClient - item.price + (item.shipping ?? 0)) * (item?.quantity ?? 1) + result.interest,
                                    shippingForUs: (item?.shipping ?? 0) * (item?.quantity ?? 1) + result.shippingForUs,
                                    updated_at: dayjs().toDate(),
                                },
                            },
                        );
                    } else {
                        const sort = await receiptsDb.count({lead: monkid(leadId), ...limitation});
                        const {name} = await suppliersDb.findOne({_id: monkid(item.supplier)});
                        const sumForClient = finalPrice(item.price, item?.interest ?? 0.3);
                        const receipt = await receiptsDb.insert({
                            deposit: 0,
                            depositForUs: 0,
                            description: "",
                            interest: (sumForClient - item.price + (item.shipping ?? 0)) * (item?.quantity ?? 1),
                            receipt: name,
                            sumForClient: (sumForClient + (item?.shipping ?? 0)) * (item?.quantity ?? 1),
                            shippingForUs: (item?.shipping ?? 0) * (item?.quantity ?? 1),
                            supplier: monkid(item.supplier),
                            lead: monkid(leadId),
                            sort,
                            status: "selection",
                            created_at: dayjs().toDate(),
                            updated_at: dayjs().toDate(),
                        });
                        await handleAddPurchases({
                            receipt: receipt._id,
                            item: item.name,
                            amount: item?.quantity ?? 1,
                            photo: item?.photos ?? [],
                            description: item?.characteristics,
                            lead: leadId,
                            quotation: monkid(quotationId),
                            product: item.product != null && monkid(item.product),
                            price: item?.price,
                            interest: item?.interest,
                            comment: item?.description,
                            shipping: item?.shipping ?? 0,
                        });
                    }
                }, quotationItems);
            },
        ),

        updateWhole: protect(
            user => user?.access?.products?.canEditQuotations, // edit
            async ({data}, user) => {
                const {login} = user;
                const author = login || "system";

                const {_id, lead, ...preparedDataWithResponsible} = data;
                const {_id: _i, lead: _l, responsibles, ...preparedDataWithoutResponsibles} = data;
                const preparedData = (await canEditResponsibles(data._id, user))
                    ? preparedDataWithResponsible
                    : preparedDataWithoutResponsibles;

                const quotation = await db.findOneAndUpdate(
                    {_id, ...limitation},
                    {
                        $set: {
                            ...preparedData,
                            lead: monkid(lead),
                            updated_at: dayjs().toDate(),
                        },
                    },
                );

                if (quotation == null) return null;

                endpoints.logs.add({
                    id: quotation._id,
                    type: "quotation",
                    event: "update",
                    author,
                });

                return quotation;
            },
            ["newQuotations"],
        ),

        delete: protect(
            user => user?.access?.products?.canDeleteQuotations, // delete
            async ({ids}, {login}) => {
                const author = login || "system";

                ids = ids.map(id => monkid(id));

                const quotations = await db.update(
                    {_id: {$in: ids}},
                    {$set: {deleted_at: dayjs().toDate()}},
                    {multi: true},
                );

                endpoints.logs.add({
                    ids: ids,
                    type: "quotation",
                    event: "delete",
                    author,
                });

                return quotations;
            },
            ["newQuotations"],
        ),

        quotationForClient: client(
            lead => lead != null,
            async ({_id}) => {
                if (!idRegex.test(_id)) {
                    return advancedResponse(404, {error: "Quotation id is not valid"});
                }
                const quotation = await db.findOneAndUpdate(
                    {_id, ...limitation},
                    {$set: {viewed_at: dayjs().toDate()}},
                );
                if (quotation == null) {
                    return advancedResponse(404, {error: "Quotation id is not valid"});
                }

                const rate = await new Promise(resolve => {
                    forex()
                        .then(data => resolve(data))
                        .catch(() =>
                            resolve({
                                USD: {
                                    value: 0.1492511936099207,
                                    previous: 0.1492494229966861,
                                    date: "2020-11-03T11:30:00+03:00",
                                },
                                EUR: {
                                    value: 0.12826668942052327,
                                    previous: 0.12782580720383813,
                                    date: "2020-11-03T11:30:00+03:00",
                                },
                                RUB: {
                                    value: 12.0259,
                                    previous: 11.8403,
                                    date: "2020-11-03T11:30:00+03:00",
                                },
                            }),
                        );
                });

                return {
                    _id: quotation._id,
                    name: quotation.name,
                    lead: quotation.lead,
                    forex: rate,
                    preliminary: quotation.preliminary,
                    created_at: quotation.created_at,
                    updated_at: quotation.updated_at,
                };
            },
        ),

        quotationsForClient: client(
            lead => lead != null,
            async (_data, lead) => {
                return db.aggregate([
                    {
                        $match: {
                            lead: monkid(lead._id),
                            ...limitation,
                        },
                    },
                    {
                        $sort: {
                            created_at: -1,
                        },
                    },
                    {
                        $lookup: {
                            from: "new_quotation_items",
                            localField: "_id",
                            foreignField: "quotation",
                            as: "items",
                        },
                    },
                    {
                        $set: {
                            itemCount: {
                                $size: {
                                    $filter: {
                                        input: "$items",
                                        as: "item",
                                        cond: {
                                            $or: [
                                                {$eq: [{$type: "$$item.deleted_at"}, "missing"]},
                                                {$eq: ["$$item.deleted_at", null]},
                                            ],
                                        },
                                    },
                                },
                            },
                        },
                    },
                    {
                        $project: {
                            _id: 1,
                            name: 1,
                            updated_at: 1,
                            itemCount: 1,
                        },
                    },
                ]);
            },
        ),

        byProduct: protect(
            user => user?.access?.products?.canSeeQuotations, //see
            async ({product, ...params}) => {
                const productOptions = await endpoints.productOptions.allByProductId(product);
                const ids = productOptions.map(option => option._id).concat(product);

                const items = await quotationItemsDb.find({
                    product: {$in: ids.map(id => monkid(id))},
                    ...limitation
                });

                const quotationIds = [...new Set(items.map(item => item.quotation))];

                return db.find({_id: {$in: quotationIds}, ...limitation}, {...params});
            },
        ),

        leadsForFilters: protect(
            user => user?.access?.products?.canSeeQuotations, // see
            async ({filters}, {login, access}) => {
                const {time, responsible, presence, search, preliminary} = filters;
                const managerQuery = access?.leads?.canSeeAllLeads
                    ? {}
                    : {
                          managers: login,
                      };

                const timeQuery =
                    time == null
                        ? []
                        : {
                              lastMonth: [
                                  {
                                      $gte: [
                                          "$created_at",
                                          dayjs().subtract(1, "month").startOf("month").toDate().toISOString(),
                                      ],
                                  },
                                  {
                                      $lte: [
                                          "$created_at",
                                          dayjs().subtract(1, "month").endOf("month").toDate().toISOString(),
                                      ],
                                  },
                              ],

                              lastWeek: [
                                  {
                                      $gte: [
                                          "$created_at",
                                          dayjs().subtract(1, "week").startOf("week").toDate().toISOString(),
                                      ],
                                  },
                                  {
                                      $lte: [
                                          "$created_at",
                                          dayjs().subtract(1, "week").endOf("week").toDate().toISOString(),
                                      ],
                                  },
                              ],

                              yesterday: [
                                  {
                                      $gte: [
                                          "$created_at",
                                          dayjs().subtract(1, "day").startOf("day").toDate().toISOString(),
                                      ],
                                  },
                                  {
                                      $lte: [
                                          "$created_at",
                                          dayjs().subtract(1, "day").endOf("day").toDate().toISOString(),
                                      ],
                                  },
                              ],
                          }[time];

                const responsibleQuery = responsible == null ? [] : [{$eq: ["$responsibles", responsible]}];
                const presenceQuery =
                    presence === "online"
                        ? [{$eq: ["online", true]}]
                        : presence === "personal"
                        ? [{$ne: ["online", true]}]
                        : [];

                // const searchQuery =
                //     search == null || search === ""
                //         ? []
                //         : [
                //               {
                //                   $regexMatch: {
                //                       input: "$name",
                //                       regex: search,
                //                       options: "i",
                //                   },
                //               },
                //           ];

                const preliminaryQuery =
                    preliminary == null
                        ? []
                        : preliminary === true
                        ? [{$eq: ["$preliminary", true]}]
                        : [{$ne: ["$preliminary", true]}];

                const searchRegex = escapedRegExp(search, "i");

                const query = [
                    {
                        $match: {
                            ...managerQuery,
                            ...presenceQuery,
                            status_id: {$not: {$in: [142, 143]}},
                        },
                    },
                    {
                        $lookup: {
                            from: "new_quotations",
                            as: "quotations",
                            let: {lead: "$_id"},
                            pipeline: [
                                {
                                    $match: {
                                        $expr: {
                                            $and: [
                                                {$eq: ["$lead", "$$lead"]},
                                                ...timeQuery,
                                                ...preliminaryQuery,
                                                // ...searchQuery,
                                                {
                                                    $or: [
                                                        {$eq: [{$type: "$deleted_at"}, "missing"]},
                                                        {$eq: ["$deleted_at", null]},
                                                    ],
                                                },
                                            ],
                                        },
                                    },
                                },
                                {
                                    $unwind: {
                                        path: "$responsibles",
                                        preserveNullAndEmptyArrays: true,
                                    },
                                },
                                ...(responsible == null
                                    ? []
                                    : [
                                          {
                                              $match: {
                                                  $expr: {
                                                      $and: [...responsibleQuery],
                                                  },
                                              },
                                          },
                                      ]),
                                // {
                                //     $group: {
                                //         _id: "$_id",
                                //     },
                                // },
                                {$project: {name: 1}}
                            ],
                        },
                    },
                    {
                        $set: {
                            quotationCount: {
                                $size: "$quotations",
                            },
                        },
                    },
                    {
                        $match: {
                            quotationCount: {$gt: 0},
                            $or: [
                                {"contacts.contact_name": {$regex: searchRegex}},
                                {"country": {$regex: searchRegex}},
                                {"city": {$regex: searchRegex}},
                                {"quotations.name": {$regex:  searchRegex}}
                            ],
                        },
                    },
                ];

                const leads = await leadsDb.aggregate(query);

                const statuses = await statusesDb.find({id: {$in: leads.map(lead => lead.status_id)}});

                const preparedLeads = leads.map(lead => {
                    const status = statuses.find(status => status.id === lead.status_id);

                    const {quotations, ...data} = lead;
                    const quotationIds = quotations.map(quotation => quotation._id);

                    return {
                        ...data,
                        quotationIds,
                        status,
                    };
                });

                return preparedLeads.sort((a, b) => {
                    const compare = b.status?.sort - a.status?.sort;
                    return compare !== 0 ? compare : b.price - a.price;
                });
            },
        ),

        forLeadForFilters: protect(
            user => user?.access?.products?.canSeeQuotations, // see
            async ({filters, leadId}) => {
                const {time, responsible, preliminary} = filters;
                const timeQuery =
                    time == null
                        ? {}
                        : {
                              lastMonth: {
                                  created_at: {
                                      $gte: dayjs().subtract(1, "month").startOf("month").toDate().toISOString(),
                                      $lte: dayjs().subtract(1, "month").endOf("month").toDate().toISOString(),
                                  },
                              },

                              lastWeek: {
                                  created_at: {
                                      $gte: dayjs().subtract(1, "week").startOf("week").toDate().toISOString(),
                                      $lte: dayjs().subtract(1, "week").endOf("week").toDate().toISOString(),
                                  },
                              },

                              yesterday: {
                                  created_at: {
                                      $gte: dayjs().subtract(1, "day").startOf("day").toDate().toISOString(),
                                      $lte: dayjs().subtract(1, "day").endOf("day").toDate().toISOString(),
                                  },
                              },
                          }[time];

                const responsibleQuery =
                    responsible == null
                        ? {}
                        : {
                              responsibles: {
                                  $elemMatch: {$eq: responsible},
                              },
                          };

                // const searchQuery =
                //     search == null || search === ""
                //         ? {}
                //         : {
                //             // name: {$regex: escapedRegExp(search, "i")},
                //             $or: [{name: {$regex: escapedRegExp(search, "i")}}]
                //           };

                const preliminaryQuery =
                    preliminary == null ? {} : preliminary === true ? {preliminary: true} : {preliminary: {$ne: true}};

                const quotations = await db.find({
                    lead: monkid(leadId),
                    ...timeQuery,
                    ...responsibleQuery,
                    // ...searchQuery,
                    ...preliminaryQuery,
                    ...limitation,
                });

                const quotationItems = await quotationItemsDb.find({
                    quotation: {$in: quotations.map(quotation => monkid(quotation._id))},
                    ...endpoints.newQuotationItems.limitation,
                });

                return quotations.map(quotation => {
                    const itemsForQuotation = quotationItems.filter(
                        item => item.quotation.toString() === quotation._id.toString(),
                    );
                    return {
                        ...quotation,
                        quotationItemCount: itemsForQuotation.length,
                    };
                });
            },
        ),

        resetPosition: protect(
            user => user?.access?.products?.canEditQuotations, // edit
            async ({_id}, {login}) => {
                const author = login || "system";

                const quotationItems = await quotationItemsDb.find(
                    {quotation: monkid(_id), ...endpoints.newQuotationItems.limitation},
                    {sort: {sort: 1}},
                );

                const result = await Promise.all(
                    quotationItems.map(async (item, index) =>
                        quotationItemsDb.findOneAndUpdate({_id: item._id}, {$set: {sort: index}}),
                    ),
                );

                endpoints.logs.add({
                    id: _id,
                    type: "quotation",
                    event: "resetPosition",
                    author,
                });

                return result;
            },
            ["newQuotationItems"],
        ),

        toExcel: protect(
            user => user?.access?.products?.canExportQuotations, // export
            async ({_id, forex = 7.1, header = true, footer = true}) => {
                const quotation = await db.findOne({_id, ...limitation});
                const quotationItems = await quotationItemsDb.find(
                    {quotation: quotation._id, ...limitation},
                    {sort: {sort: 1}},
                );

                quotation.items = quotationItems;

                const lead = await endpoints.leads.db.findOne({_id: quotation.lead, ...limitation});
                const language = quotation.language ?? "en";

                // eslint-disable-next-line immutable/no-let
                let workbook = new Excel.Workbook();
                workbook.creator = "Globus";
                workbook.lastModifiedBy = "Globus";
                workbook.created = new Date();
                workbook.modified = new Date();

                // eslint-disable-next-line immutable/no-let
                let sheet = workbook.addWorksheet(quotation.name, {
                    pageSetup: {
                        fitToPage: true,
                        fitToWidth: 1,
                    },
                });

                const columnsMetas = [
                    {header: "#", key: "n", width: 10},
                    {header: translate(language, "Item ID"), key: "itemId", width: 15},
                    {header: translate(language, "Photo"), key: "photo", width: 50},
                    {header: translate(language, "Item"), key: "item", width: 40},
                    {header: translate(language, "Amount"), key: "quantity", width: 12},
                    {header: translate(language, "Characteristics"), key: "characteristics", width: 60},
                    {header: translate(language, "Description"), key: "description", width: 60},
                    {header: translate(language, "Price"), key: "price", width: 20},
                    {header: translate(language, "Weight"), key: "weight", width: 20},
                    {header: translate(language, "Volume"), key: "volume", width: 20},
                ];

                if (header) await addHeader(workbook, sheet, language, lead?.contacts?.[0]?.contact_name ?? "");

                const titleRowIndex = sheet.rowCount + 1;

                defineColumns(sheet, columnsMetas);
                addTableTitle(sheet, columnsMetas, titleRowIndex);
                addTableBody(sheet, quotation, forex);
                const desiredRowHeights = await addImagesIntoTableBody(workbook, sheet, quotation, titleRowIndex + 1);

                if (footer) addFooter(sheet, language);

                sheet.eachRow(row => {
                    row.eachCell({includeEmpty: true}, cell => {
                        if (cell.row >= titleRowIndex) {
                            cell.style.font = {
                                size: 17,
                                name: "Roboto",
                            };
                        }
                        cell.style.alignment = {wrapText: true, vertical: "middle", horizontal: "center"};
                        if (cell.col === 2 && cell.row > titleRowIndex) {
                            if (desiredRowHeights[parseInt(cell.row)] != null) {
                                row.height = desiredRowHeights[parseInt(cell.row)];
                            }
                            //console.log('image cell', cell.row)
                        }
                    });
                });

                if (!header) sheet.views = [{state: "frozen", xSplit: 0, ySplit: 1}];

                return endpoints.files.saveFile(await workbook.xlsx.writeBuffer(), {
                    filename: `${quotation.lead}-${quotation.name}-${dayjs().unix()}.xlsx`,
                });
            },
        ),
    },
    {
        db,
    },
);
