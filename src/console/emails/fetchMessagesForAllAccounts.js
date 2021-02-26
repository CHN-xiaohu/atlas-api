import {forEachP} from "../../helper";
import {mongo} from "../../lib/db";
import axios from "axios";
import {print, retry} from "../helper";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

const db = mongo.get("emails");
const accountDb = mongo.get("email_accounts");

// db.drop();
// accountDb.drop();

const DEVELOPMENT_SETTINGS = {
    responseType: "json",
    baseURL: "https://mail.globus.furniture",
    auth: {
        username: "globus",
        password: "SQquP1oQQcOujhl59H",
    },
    proxy: false,
    timeout: 1000 * 60 * 60,
};

const PRODUCTION_SETTINGS = {
    responseType: "json",
    baseURL: "http://localhost:3000",
};

const pageSize = 50;

const {get} = axios.create(IS_PRODUCTION ? PRODUCTION_SETTINGS : DEVELOPMENT_SETTINGS);

const calcMessageTotalPage = (total, pageSize = 50) => Math.ceil(total / pageSize);

const getPerMessageBoxPage = async (accountId, box, page, pageSize = 50) => {
    console.log(`accountId: ${accountId}, path: ${box.path}, page: ${page}, pageSize: ${pageSize}`);
    const {
        data: {messages},
    } = await get(`/v1/account/${accountId}/messages`, {
        params: {
            path: box.path,
            page,
            pageSize,
        },
    });

    const records = messages.reduce(
        (result, msg) =>
            result.concat(
                msg?.to?.map(t => ({
                    ...msg,
                    to: {...t},
                    account: accountId,
                    boxName: box.name,
                    boxPath: box.path,
                    isRead: true,
                    deleted_at: null,
                })) || msg,
            ),
        [],
    );

    await Promise.all(records.map(async (message) => {
        await db.update(
            {
                id: message.id
            },
            {$set: message},
            {
                upsert: true
            }
        )
    }))
};

const getAccountMsgs = async accountId => {
    const {
        data: {mailboxes},
    } = await get(`/v1/account/${accountId}/mailboxes`);

    await forEachP(async box => {
        const total = calcMessageTotalPage(box.messages, pageSize);
        // eslint-disable-next-line immutable/no-let
        for (let page = 0; page < total; page++) {
            await retry({
                maxTimes: 6,
                callback: () => getPerMessageBoxPage(accountId, box, page),
                onError: (error, times) => print(`第 ${times} 次重试`, {accountId, box, page, pageSize, error: error.message}),
                onMaxTimesError: () => print("超过最大重试次数", {accountId, box, page, pageSize})
            });
        }
    }, mailboxes);
};

const getMsgsOfAllAccounts = async () => {
    try {
        const accounts = await accountDb.find({});
        await forEachP(async ({account}) => {
            console.log("cur accountId: ", account);
            await getAccountMsgs(account);
        }, accounts);
    } catch (error) {
        console.log(error);
        throw Error({
            error,
            message: "fetch emails data error",
        });
    }
};

const getGlobusAccounts = async () => {
    try {
        const {
            data: {accounts},
        } = await get("/v1/accounts");
        await accountDb.insert(
            await Promise.all(
                accounts.map(async ({account, name}) => {
                    const {
                        data: {mailboxes},
                    } = await get(`/v1/account/${account}/mailboxes`);
                    const sendBox =
                        mailboxes?.length > 0 &&
                        mailboxes.find(box => box.specialUse === "\\Sent");
                    return {account, name, path: sendBox?.path ?? ""};
                }),
            ),
        );
    } catch (error) {
        console.error("fetch all of globus accounts fail");
        throw error;
    }
};

(async () => {
    try {
        print("script start");
        await getGlobusAccounts();
        await getMsgsOfAllAccounts();
        console.log("sync emails success");
    } catch (error) {
        console.error("sync error: ", error);
    }
})();
