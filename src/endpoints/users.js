import {endpoint, protect} from "../lib/api-helper";
import {mongo} from "../lib/db";
import dayjs from "dayjs";
import {escape, hash} from "../helper";
import {wechatPost} from "../lib/qiyeweixin";

const AGENTID = 1000009;
const secret = "qYПЧпcЬpdО8ГoМтЗPиВыQнРЖДUЛ#kDЫlQркОтATЖЛФЭКЬвOUТщ";
const defaults = {
    skip: 0,
    limit: 0,
    projection: {
        password: 0,
        access: 0,
    },
    sort: {
        priority: 1,
    },
};

const db = mongo.get("users");
const sessionsDb = mongo.get("sessions");

const logout = async ({login}) => {
    const result = await sessionsDb.remove({login});
    return {status: `${result.result.n} sessions deleted`};
};

export const users = endpoint(
    {
        byLogin: protect(
            user => user?.access?.users?.canEditAll,
            async ({login}) => {
                return db.findOne({login});
            },
        ),

        managers: protect(
            user => user?.access?.users?.canSeeUsers, //see
            async ({...params}) => {
                return db.find({title: 'client manager'}, {...defaults, ...params});
                //console.log(managers[0]);
            },
        ),

        get: protect(
            user => user?.access?.users?.canSeeUsers, //see
            async ({banned}) => {
                const bannedQuery = banned == null ? {} : {banned: {$ne: true}};
                return db.find({...bannedQuery}, {...defaults});
            },
        ),

        changeSelf: protect(
            (user, {key}) => user?.access?.users?.canEditSelf && ["avatar", "name", "shortName"].includes(key),
            async ({key, value}, {login}) => {
                return await db.findOneAndUpdate({login}, {$set: {[key]: value}});
            },
            ["users"],
        ),

        changeAll: protect(
            user => user?.access?.users?.canEditAll,
            async ({login, key, value}) => {
                return await db.findOneAndUpdate({login}, {$set: {[key]: value}});
            },
            ["users"],
        ),

        block: protect(
            user => user?.access?.users?.canBlockUsers, //block
            async ({login, value = true}) => {
                const user = await db.findOneAndUpdate({login}, {$set: {banned: value}});
                if (user != null) {
                    await logout({login});
                    return {status: "User has been successfully (un)blocked"};
                } else {
                    return {error: "User not found"};
                }
            },
            ["users"],
        ),

        sendAuthCode: protect(
            _user => true,
            async ({login}) => {
                //create new session
                const lifetime = 60 * 60 * 24 * 7;
                const now = dayjs();
                const user = await db.findOne({login: new RegExp(`^${escape(login)}$`, 'i')});

                if (user != null && !user.banned) {
                    const session = await hash(now.valueOf().toString() + user.login, secret);
                    const code = new Array(6)
                        .fill(0)
                        .map(() => Math.floor(Math.random() * 10).toString())
                        .join("");

                    sessionsDb.insert({
                        login: user.login,
                        session,
                        expire: now.unix() + lifetime,
                        created: now.unix(),
                        code,
                    });

                    return wechatPost("message/send", {
                        touser: user.qiyeweixin,
                        msgtype: "text",
                        agentid: AGENTID,
                        text: {
                            content: `登录验证码：${code}`,
                        },
                    });
                } else {
                    return {error: "User doesn't exist or banned"};
                }
            },
        ),

        auth: protect(
            _user => true,
            async ({login, code}) => {
                const loginRegex = new RegExp(`^${escape(login)}$`, "i")
                const lifetime = 60 * 60 * 24 * 7;
                const now = dayjs();
                const session = await sessionsDb.findOne({
                    login: loginRegex,
                    code,
                    expire: {$gt: now.unix()},
                });
                if (session != null) {
                    const user = await db.findOneAndUpdate(
                        {login: loginRegex},
                        {$set: {lastLogin: now.toDate(), failedAttempts: 0}},
                    );

                    console.log(
                        "[users]",
                        "new session for",
                        login,
                        "expire",
                        dayjs.unix(now.unix() + lifetime).format("DD MMMM YYYY"),
                    );

                    return {...user, session: session.session, expire: session.expire, password: undefined};
                } else {
                    const user = await db.findOne({login});
                    const banned = user.failedAttempts >= 5;
                    db.findOneAndUpdate({login: loginRegex}, {$inc: {failedAttempts: 1}, $set: {banned}});
                    return {error: "Wrong login or code"};
                }
            },
            ["users"],
        ),

        logout: protect(
            user => user?.access?.users?.canLickUsers, //kick
            logout,
            ["users"],
        ),
    },
    {
        db,
        getUser: async session => {
            const now = dayjs();
            if (typeof session !== 'string' || session.length === 0) {
                return null;
            }
            const sess = await sessionsDb.findOne({session, expire: {$gte: now.unix()}});
            if (sess == null) {
                return null;
            }
            const result = await db.findOneAndUpdate({login: sess.login}, {$set: {lastOnline: now.toDate()}});
            if (result == null) {
                return null;
            }
            const {password: _, ...user} = result;
            return user == null ? null : {...user, session};
        },
    },
);
