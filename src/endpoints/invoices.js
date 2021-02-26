import {endpoint, protect} from "../lib/api-helper";
import {endpoints} from "../lib/endpoints";

import sharp from "sharp";
import axios from "axios";
import Excel from "exceljs";

const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const handleImages = async (workbook, data, rows = ["photo"]) => {
    const items = rows
        .map(field => data.filter(r => r[field] != null).map(r => (Array.isArray(r[field]) ? r[field][0] : r[field])))
        .flat();
    const links = items.filter(item => item?.startsWith("http"));
    const ids = items.filter(item => item != null && !item.startsWith("http"));
    const photos = await endpoints.files.getFiles({link: {$in: links}});

    // handle the old method
    const imagePromises = photos.reduce((o, photo) => {
        try {
            o[photo.link] = sharp(photo.pathOnDisk)
                .resize(280, null, {fit: "inside", withoutEnlargement: true})
                .png()
                .toBuffer({resolveWithObject: true});
        } catch (e) {
            console.log(e);
        }
        return o;
    }, {});

    // eslint-disable-next-line immutable/no-let
    let addedImages = {};
    // eslint-disable-next-line immutable/no-let
    let addedImagesInfo = {};
    // eslint-disable-next-line immutable/no-let
    for (let link of links) {
        try {
            const {data, info} = await imagePromises[link];
            addedImages[link] = workbook.addImage({
                buffer: data,
                extension: "png",
            });
            addedImagesInfo[link] = info;
        } catch (e) {
            console.log(e);
        }
    }

    // handle the new method
    const idImageBufferPromises = ids.map(id => {
        return (async () => {
            const img = await endpoints.images.get({photo: id + "|original"}, true);
            const response = await axios.get(img.link, {responseType: "arraybuffer"});
            const buffer = await Buffer.from(response.data, "binary");
            const addedImageId = workbook.addImage({buffer, extension: "png"});
            const meta = await sharp(buffer).metadata();
            return {
                id,
                addedImageId,
                info: {
                    format: "png",
                    width: meta.width,
                    height: meta.height,
                    channels: meta.channels,
                    premultiplied: null,
                    size: meta.size,
                },
            };
        })();
    });

    const idImageBuffers = await Promise.all(idImageBufferPromises);

    const {images: addedIdImages, infos: addedIdImagesInfo} = idImageBuffers.reduce(
        (o, item) => {
            o.images[item.id] = item.addedImageId;
            o.infos[item.id] = item.info;
            return o;
        },
        {images: {}, infos: {}},
    );

    // merge the images of the old method and the images of the new method
    addedImages = {
        ...addedImages,
        ...addedIdImages,
    };
    addedImagesInfo = {
        ...addedImagesInfo,
        ...addedIdImagesInfo,
    };

    return [addedImages, addedImagesInfo];
};

export const invoices = endpoint(
    {
        generateExcel: protect(
            user => user?.access?.leads?.canSeePurchases,
            async ({columns, data, mergedCells, name = "output"}) => {
                const workbook = new Excel.Workbook();
                const sheet = workbook.addWorksheet("My Sheet");
                //const filteredColumns = columns.filter(column => column.type !== 'image' || data.filter(row => row[column.key] != null).length > 0)
                sheet.columns = columns;
                const imageColumns = columns
                    .filter(column => column.type === "image" || column.type === "images")
                    .map(column => column.key);
                const [images, info] = await handleImages(workbook, data, imageColumns);
                data.forEach(row => {
                    sheet.addRow(row);
                });
                data.forEach((row, rowIndex) => {
                    // eslint-disable-next-line immutable/no-let
                    let imageHeights = [];
                    imageColumns.forEach(column => {
                        try {
                            const link = Array.isArray(row[column]) ? row[column][0] : row[column];
                            const index = Object.keys(row).findIndex(c => c === column);
                            if (link != null) {
                                const imageInfo = info[link];
                                if (imageInfo != null) {
                                    const {width, height} = info[link];
                                    const ratio = width / height;
                                    const finalWidth = 280;
                                    const finalHeight = finalWidth / ratio;
                                    sheet.addImage(images[link], {
                                        tl: {col: index, row: rowIndex + 1},
                                        ext: {width: finalWidth, height: finalHeight},
                                    });
                                    sheet.getRow(rowIndex + 2).getCell(column).value = "";
                                    imageHeights.push(finalHeight);
                                }
                            }
                        } catch (e) {
                            console.error(e);
                        }
                    });
                    sheet.getRow(rowIndex + 2).height = Math.max(...imageHeights) / 1.33;
                });

                mergedCells.forEach(cells => {
                    sheet.mergeCells(cells);
                });

                const rowsLetters = columns.reduce((store, column, index) => {
                    store[columns[index].key] = letters[index];
                    return store;
                }, {});

                columns.forEach((column, index) => {
                    if (column.formula != null) {
                        const letter = rowsLetters[column.key];
                        const lastRow = data.length + 1;
                        // eslint-disable-next-line immutable/no-let
                        let formula = column.formula.replace("#ROW", `${letter}2:${letter}${lastRow}`);
                        if (formula.includes("$")) {
                            const matches = formula.match(/(\$\w+)/g);
                            matches.forEach(match => {
                                const key = match.substring(1);
                                formula = formula.replace(
                                    new RegExp(match.replace(/\$/g, "\\$"), "g"),
                                    `${rowsLetters[key]}${lastRow + 1}`,
                                );
                            });
                        }
                        sheet.getCell(lastRow + 1, index + 1).value = {formula};
                    }
                });
                sheet.eachRow(row => {
                    row.eachCell(cell => {
                        cell.alignment = {wrapText: true, vertical: "middle", horizontal: "center"};
                    });
                });
                sheet.views = [{state: "frozen", xSplit: 0, ySplit: 1}];
                return await endpoints.files.saveFile(await workbook.xlsx.writeBuffer(), {filename: `${name}.xlsx`});
            },
        ),
    },
    {},
);
