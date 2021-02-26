import {mongo} from "./db";
import queryString from "query-string";
import axios from "axios";

const {post, get} = axios.create({
    responseType: "json",
});

// const token = "5pvl05qk821lh1pl";
// const url = "https://eu148.chat-api.com/instance190084/";

const db = mongo.get("test");

export const onNewMessage = data => {
    return db.insert(data);
};

export const information = {
    195780: {
        instance: "195780",
        name: "Maria",
        url: "https://eu192.chat-api.com/instance195780",
        token: "osfseanpeq1d4j1s",
    },
    195837: {
        instance: "195837",
        name: "Alena",
        url: "https://eu214.chat-api.com/instance195837",
        token: "dd6m274bbb61a7s8",
    },
    213509: {
        instance: "213509",
        name: "Annagoncharova",
        url: "https://eu194.chat-api.com/instance213509/",
        token: "kw8cfkotm07glawt",
    },
};
const defaultInstance = "195780";

export const whatsapp = {
    information,
    defaultInstance,
    instance: defaultInstance,

    request: async (instance, link, qs = {}) => {
        try {
            const {url, token} = information[instance];
            const query = queryString.stringify({
                token,
                ...qs,
            });
            const response = await get(`${url}${link}?${query}`);
            return response.data;
        } catch (e) {
            console.error(e);
        }
    },

    post: async (instance, link, qs = {}, body = {}) => {
        try {
            const {url, token} = information[instance];
            const query = queryString.stringify({
                token,
                ...qs,
            });
            const response = await post(`${url}${link}?${query}`, body);
            return response.data;
        } catch (e) {
            console.error(e);
        }
    },

    binaryRequest: async (instance, link, qs = {}) => {
        try {
            const {url, token} = information[instance];
            const query = queryString.stringify({
                token,
                ...qs,
            });
            const response = await axios.get(`${url}${link}?${query}`, {responseType: "arraybuffer"});
            return response.data;
        } catch (e) {
            console.error(e);
        }
    },
};
