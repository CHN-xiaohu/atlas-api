import dayjs from "dayjs";
import fetch from "node-fetch";
import axios from "axios";

const SECRET = "Me7IY0scsKN-J5sagekSRutnY06zt4OB5fqccHZYxrw";
const CORPID = "ww71dee0f5a6c5fce7";

const fetchAccessToken = async () =>
    await fetch(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${CORPID}&corpsecret=${SECRET}`).then(response =>
        response.json(),
    );

const getAccessToken = (() => {
    // eslint-disable-next-line immutable/no-let
    let accessToken;
    // eslint-disable-next-line immutable/no-let
    let expireTime;

    return async () => {
        if (accessToken != null && expireTime != null && dayjs(expireTime).isAfter(dayjs())) {
            return accessToken;
        } else {
            const token = await fetchAccessToken();
            accessToken = token.access_token;
            expireTime = dayjs().add(token.expires_in, "second");
            return accessToken;
        }
    };
})();

export const wechatGet = async (endpoint, params) => {
    const access_token = await getAccessToken();
    const url = `https://qyapi.weixin.qq.com/cgi-bin/${endpoint}`;
    const {data} = await axios.get(url, {params: {access_token, ...params}});
    return data;
};

export const wechatPost = async (endpoint, data) => {
    const token = await getAccessToken();
    const url = `https://qyapi.weixin.qq.com/cgi-bin/${endpoint}?access_token=${token}`;
    const response = await fetch(url, {
        method: "POST",
        body: JSON.stringify(data),
    });
    return await response.json();
};

export const wechatWebhook = async (key, data) => {
    const url = `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${key}`;
    const response = await fetch(url, {
        method: "POST",
        body: JSON.stringify(data),
    });
    try {
        return response.json();
    } catch (e) {
        console.log(e);
        return response.text();
    }
};

export const DEVELOPERS_CHAT_BOT_KEY = "b1fc136a-6929-4787-8595-73402f3e4f03";
