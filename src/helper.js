import dayjs from "dayjs";
import os from "os";
import crypto from "crypto";
import {id as monkid} from "./lib/db";
import {v4 as uuidv4} from "uuid";
import {curry, composeWith} from "ramda";
import {isHoliday} from "china-holidays";
import fs from "fs";
import {promisify} from "util";
import {presetPalettes} from "@ant-design/colors";

export const idRegex = /^[a-f\d]{24}$/i;

export const hash = (string, key = "23l4uq2i34yazuxhnxilo8wu43ijai2pexgnox89w48ozrmdicx59748345") => {
    return crypto.createHmac("sha256", key).update(string).digest("hex");
};

export const timezoneCurrentTime = zone => {
    return dayjs(new Date().toLocaleString("en-US", {timeZone: zone}));
};

export const ellipsis = (str, limit) => {
    if (str.length > limit) {
        return `${str.substring(0, limit)}…`;
    }
    return str;
};

export const phoneCallTime = (timezone, desiredDay = dayjs(), workStart = 10, wordEnd = 19) => {
    const clientTime = timezoneCurrentTime(timezone);
    const diff = -clientTime.diff(dayjs(), "hour");
    const clientStart = desiredDay.set("hour", 10).set("minute", 0).set("second", 0).add(diff, "hour");
    const clientEnd = desiredDay.set("hour", 21).set("minute", 0).set("second", 0).add(diff, "hour");

    //console.log('client time', clientStart.format('HH:mm'), clientEnd.format('HH:mm'))
    const globusStart = desiredDay.set("hour", workStart).set("minute", 0).set("second", 0);
    const globusEnd = desiredDay.set("hour", wordEnd).set("minute", 0).set("second", 0);
    //console.log('globus time', globusStart.format('HH:mm'), globusEnd.format('HH:mm'))
    const start = clientStart.isBefore(globusStart) ? globusStart : clientStart;
    const end = clientEnd.isBefore(globusEnd) ? clientEnd : globusEnd;
    return start.add(Math.floor(end.diff(start, "minute") * Math.random()), "minute");
};

export const rateClient = (client, dollarRate = 7) => {
    if (client.price > 0.9 * dollarRate * 200000) {
        return 3;
    }
    if (client.price > 0.9 * dollarRate * 100000) {
        return 2;
    }
    if (client.price > 0.9 * dollarRate * 50000) {
        return 1;
    }
    return 0;
};

export const isWorkingTime = (time = dayjs(), startHour = 10, endHour = 18) => {
    return !(
        isHoliday(time.toDate()) ||
        time.day() === 0 ||
        time.day() === 7 ||
        time.hour() < startHour ||
        time.hour() > endHour
    );
};

export const message = fields => {
    return Object.keys(fields)
        .filter(k => fields[k] != null)
        .map(field => `[${field}]: ${fields[field]}`)
        .join(os.EOL);
};

export const random = (start, end) => {
    return Math.floor(Math.random() * end) + start;
};

const capitalize = s => {
    if (typeof s !== "string") return s;
    return s.charAt(0).toUpperCase() + s.slice(1);
};

export const leadName = lead => {
    const contact =
        lead.contact_name == null
            ? "Incognito"
            : lead.contact_name
                  .split(" ")
                  .map(p => capitalize(p.toLowerCase()))
                  .join(" ");
    return [contact, lead.country, lead.city].filter(el => el != null).join(" ");
};

export const contactName = contact => contact?.contact_name ?? contact?.phone ?? contact?.whatsapp ?? contact?._id;

export const getTaskCompleteTime = (time = dayjs(), priority = "normal") => {
    const day = time.day();
    const hours = +time.format("H");
    const today = time.isSame(dayjs(), "day");

    if (priority === "high" && isWorkingTime(time) && today) {
        return time.add(30, "minute").toDate();
    }

    if (day > 0 && day < 6 && !isHoliday(time.toDate())) {
        if ((today && hours < 10) || !today) {
            return time.set("hour", 23).set("minute", random(0, 60)).toDate();
        } else if (today && hours < 17) {
            return time.set("hour", 23).set("minute", random(0, 60)).toDate();
        }
    }
    return getTaskCompleteTime(time.add(1, "day"));
};

export const resolve = (path, obj, separator = ".") => {
    const properties = path.split(separator);
    return properties.reduce((prev, curr) => prev && prev[curr], obj);
};

export const groupBy = (items, key, preserveUndefined = false) => {
    if (!Array.isArray(items)) {
        return false;
    }
    const grouped = items.reduce(
        (result, item) => ({
            ...result,
            [item[key]]: [...(result[item[key]] || []), item],
        }),
        {},
    );
    if (!preserveUndefined) {
        delete grouped.undefined;
    }
    return grouped;
};

export const arrayToString = (a, divider = " ") => {
    if (!Array.isArray(a)) {
        return "";
    }
    return a.filter(e => e != null).join(divider);
};

export const parseNumber = id => +`${id}`.match(/\d+/)[0];

const first = 16 ** 5;

export const numberToItemId = number => {
    return (number + first).toString(16).toUpperCase();
}

export const itemIdToNumber = id => {
    return parseInt(id, 16) - first;
}

const dryDataOff = d => (typeof d === "function" ? d() : d);

export const buildQuery = pipeline =>
    pipeline.reduce(
        (result, {condition = true, fallback = {}, query = {}}) => ({
            ...result,
            ...dryDataOff(condition ? query : fallback),
        }),
        {},
    );

export const changePosition = async ({_id, destSort, db, parentKeyName, limitation = {deleted_at: {$eq: null}}}) => {
    const item = await db.findOne({_id, ...limitation});
    if (item == null) return null;
    if (item.sort === destSort) return item;

    const isLower = item.sort > destSort;
    const srcSort = item.sort;

    if (isLower) {
        await db.update(
            {[parentKeyName]: monkid(item[parentKeyName]), sort: {$gte: destSort, $lt: srcSort}, ...limitation},
            {$inc: {sort: 1}},
            {multi: true},
        );
    } else {
        await db.update(
            {[parentKeyName]: monkid(item[parentKeyName]), sort: {$gt: srcSort, $lte: destSort}, ...limitation},
            {$inc: {sort: -1}},
            {multi: true},
        );
    }

    return db.findOneAndUpdate({_id: item._id}, {$set: {sort: destSort}});
};

export const deleteWithPosition = async ({ids, db, parentKeyName, limitation = {deleted_at: {$eq: null}}}) => {
    ids = ids.map(id => monkid(id));

    const items = await db.find({_id: {$in: ids}});

    return Promise.all(
        items.map(async item => {
            await db.update(
                {[parentKeyName]: monkid(item[parentKeyName]), sort: {$gt: item.sort}, ...limitation},
                {$inc: {sort: -1}},
                {multi: true},
            );

            return db.findOneAndUpdate({_id: item._id}, {$set: {deleted_at: dayjs().toDate()}}, {multi: true});
        }),
    );
};

const hexToRgb = (hex) => {
    // eslint-disable-next-line immutable/no-let
    let c;
    if (/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)) {
        c = hex.substring(1).split("");
        if (c.length === 3) {
            c = [c[0], c[0], c[1], c[1], c[2], c[2]];
        }
        c = "0x" + c.join("");
        return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
    }
}

export const color = (type, level, opacity = 1) => {
    const names = Object.keys(presetPalettes);
    const index = typeof type === "number" ? names[type % names.length] : type;
    const c = presetPalettes[index] ?? presetPalettes.grey;
    if (opacity < 1) {
        const [r, g, b] = hexToRgb(c[level ?? 5]);
        return `rgba(${r}, ${g}, ${b}, ${opacity})`;
    }
    return c[level ?? 5];
}

export const escape = string => (string ?? "").toString().replace(/(?=\W)/g, '\\')

export const escapedRegExp = (template, ...args) => {
    return new RegExp(escape(template), ...args);
}

export const randomColor = () => {
    const colors = [
        "red",
        "volcano",
        "gold",
        "orange",
        "yellow",
        "lime",
        "green",
        "cyan",
        "blue",
        "geekblue",
        "purple",
        "magenta",
    ];

    const randomColor = random(0, colors.length);
    const randomLevel = random(0, 10);
    return color(randomColor, randomLevel);
}

export const createIdGenerator = (initSequence = 0) => {
    /* eslint-disable-next-line immutable/no-let */
    let nextSequence = initSequence;

    return () => {
        const uuid = uuidv4();
        const time = new Date().getTime();
        const sequence = nextSequence++;
        return `${uuid}${time}${sequence}`;
    };
};

export const generateId = createIdGenerator();

export const composeP = (...params) => {
    return composeWith(async (f, res) => f(await res), params);
};

export const tapP = curry((fn, x) => {
    return (async () => {
        await fn(x);
        return x;
    })();
});

export const forEachP = curry((fn, list) => {
    return (async () => {
        // eslint-disable-next-line immutable/no-let
        let i = 0;
        // eslint-disable-next-line immutable/no-let
        for (let key in list) {
            await fn(list[key], key, i++, list);
        }
    })();
});

export const mapP = curry((fn, list) => {
    return (async () => {
        const results = [];
        // eslint-disable-next-line immutable/no-let
        let i = 0;
        // eslint-disable-next-line immutable/no-let
        for (let key in list) {
            const result = await fn(list[key], key, i++, list);
            results.push(result);
        }

        return results;
    })();
});

export const reduceP = curry((fn, initialAcc, list) => {
    return (async () => {
        // eslint-disable-next-line immutable/no-let
        let acc = initialAcc;
        // eslint-disable-next-line immutable/no-let
        let i = 0;
        // eslint-disable-next-line immutable/no-let
        for (let key in list) {
            acc = await fn(acc, list[key], key, i++, list);
        }

        return acc;
    })();
});

export const mostWantedItemOfArrayBy = curry((fn, list) => {
    return list.reduce((max, item) => fn(max, item));
})

export const maxItemOfArray = (list) => {
    return mostWantedItemOfArrayBy((a, b) => {
        return a > b ? a : b;
    }, list)
};

export const minItemOfArray = (list) => {
    return mostWantedItemOfArrayBy((a, b) => {
        return a < b ? a : b;
    }, list)
};

export const splitArray = (numberPerPart, arr) => {
    // eslint-disable-next-line immutable/no-let
    let index = 0;
    // eslint-disable-next-line immutable/no-let
    let result = [];
    while(index < arr.length) {
        result.push(arr.slice(index, index += numberPerPart));
    }
    return result;
};


const mkdir = promisify(fs.mkdir);
export const exists = async path => {
    return new Promise(resolve => {
        fs.access(path, fs.constants.F_OK, err => {
            if (err) {
                resolve(false);
            } else {
                resolve(true);
            }
        });
    });
};

export const mkdirpIfNotExists = async path => {
    if (!(await exists(path))) await mkdir(path, {recursive: true});
};

export const benchmark = () => {
    const first = +new Date();
    return name => {
        const second = +new Date();
        const lag = second - first;
        if (name != null) {
            console.log(name, `${lag}ms`);
        }
        return lag;
    };
};

const defaultFunc = () => {};
export const retry = async ({
    maxTimes = 3,
    callback = defaultFunc,
    onError = defaultFunc,
    onMaxTimesError = defaultFunc,
    initTimes = 1
}) => {
    if (initTimes > maxTimes) return onMaxTimesError(initTimes);

    try {
        return callback(initTimes);
    } catch (error) {
        await onError(error, initTimes);
        await retry({callback, onError, maxTimes, initTimes: initTimes +1});
    }
}
