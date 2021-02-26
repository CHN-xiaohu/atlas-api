import {forEachP} from "../../helper";
import {mongo} from "../../lib/db";
import axios from "axios";
import {print, retry} from "../helper";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

const db = mongo.get("emails");
const accountDb = mongo.get("email_accounts");

const DEVELOPMENT_SETTINGS = {
    responseType: "json",
    baseURL: "https://mail.globus.furniture",
    auth: {
        username: "globus",
        password: "SQquP1oQQcOujhl59H",
    },
    proxy: false,
    timeout: 1000 * 60,
};

const PRODUCTION_SETTINGS = {
    responseType: "json",
    baseURL: "http://localhost:3000",
    timeout: 1000 * 60 * 2,
};

const pageSize = 50;
const maxRetryTimes = 10;
const accounts = process.argv.slice(2);

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

    await Promise.all(
        records.map(async message => {
            await db.update(
                {
                    id: message.id,
                },
                {$set: message},
                {
                    upsert: true,
                },
            );
        }),
    );
};

const getAccountMsgs = async accountId => {
    const {
        data: {mailboxes},
    } = await get(`/v1/account/${accountId}/mailboxes`);

    await forEachP(async box => {
        const total = calcMessageTotalPage(box.messages, pageSize);
        console.log(`box: ${box.path}, messages: ${box.messages}, totalPage: ${total}, pageSize: ${pageSize}`);
        // eslint-disable-next-line immutable/no-let
        for (let page = 0; page < total; page++) {
            await retry({
                maxTimes: maxRetryTimes,
                callback: () => getPerMessageBoxPage(accountId, box, page),
                onError: (error, times) =>
                    print(`第 ${times} 次重试`, {accountId, box, page, pageSize, error: error.message}),
                onMaxTimesError: () => print("超过最大重试次数", {accountId, box, page, pageSize}),
            });
        }
    }, mailboxes);
};

const getMsgsOfAllAccounts = async () => {
    try {
        await forEachP(async account => {
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

const checkInputAccountsValidate = async () => {
    const {
        data: {accounts: boxes},
    } = await get("/v1/accounts");
    const globusAccounts = boxes.map(({account}) => account);
    accounts.forEach(acc => {
        if (globusAccounts.includes(acc)) return;
        throw new Error(`${acc} is not in golbusEmails`);
    });
    print(`${accounts} is validate`);
};

const getGlobusAccounts = async () => {
    try {
        const globusAccounts = await Promise.all(
            accounts.map(async account => {
                const {
                    data: {mailboxes},
                } = await get(`/v1/account/${account}/mailboxes`);
                const sendBox = mailboxes?.length > 0 && mailboxes.find(box => box.specialUse === "\\Sent");
                return {account, name: account, path: sendBox?.path ?? ""};
            }),
        );
        console.log("globusAccounts: ", globusAccounts);
        await Promise.all(
            globusAccounts.map(async acc => {
                await accountDb.update(
                    {
                        account: acc.account,
                    },
                    {$set: acc},
                    {
                        upsert: true,
                    },
                );
            }),
        );
    } catch (error) {
        console.error("fetch all of globus accounts fail");
        throw error;
    }
};

(async () => {
    try {
        print("script start");
        await checkInputAccountsValidate();
        await getGlobusAccounts();
        await getMsgsOfAllAccounts();
        print(`refresh messages of ${accounts} success`);
    } catch (error) {
        console.error("sync error: ", error);
    }
})();
