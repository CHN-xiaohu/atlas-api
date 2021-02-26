import {mongo} from "../../lib/db";
import {forEachP} from "../../helper";
import {assoc} from "ramda";
import {presetPalettes} from "@ant-design/colors";

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
    "grey",
];

const random = (start, end) => {
    return Math.floor(Math.random() * end) + start;
};

function hexToRgb(hex) {
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

function color(type, level, opacity = 1) {
    const names = Object.keys(presetPalettes);
    const index = typeof type === "number" ? names[type % names.length] : type;
    const c = presetPalettes[index] ?? presetPalettes.grey;
    if (opacity < 1) {
        const [r, g, b] = hexToRgb(c[level ?? 5]);
        return `rgba(${r}, ${g}, ${b}, ${opacity})`;
    }
    return c[level ?? 5];
}

const db = mongo.get("leads");

(async () => {
    const leads = await db.find({"contacts.background": {$eq: null}});


    await forEachP(async lead => {
        if (Object.prototype.toString.call(lead?.contacts) !== "[object Array]") return;

        const newContacts = lead.contacts.map(contact => {
            const randomColor = random(0, colors.length);
            const randomLevel = random(0, 10);

            return contact.background === undefined
            ? assoc("background", color(randomColor, randomLevel), contact)
            : contact;
        });

        await db.update({_id: lead._id}, {$set: {contacts: newContacts}});
    }, leads);

    console.log("执行完毕");
})();
