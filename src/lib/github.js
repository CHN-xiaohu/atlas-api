import {DEVELOPERS_CHAT_BOT_KEY, wechatWebhook} from "./qiyeweixin";

const logins = {
    faradaytrs: "安然",
    "CHN-xiaohu": "小虎",
    devchn: "浩南",
    xqinwl: "文龙",
};

const events = {
    release: {
        published: event => {
            const author = logins[event.release.author.login] ?? event.release.author.login;
            const projectFullName = event.repository.full_name;
            const projectName = event.repository.name;
            const release = event.release.tag_name;
            const githubUrl = event.repository.html_url;
            const url = event.release.html_url;
            const changelog = event.release.body;
            return `${author} 在[${projectFullName}](${githubUrl}) 发布了新版本 [${projectName}${release}](${url})
${changelog}`;
        },
    },
    push: event => {
        const author = logins[event.pusher.name] ?? event.pusher.name;
        const project = event.repository.full_name;
        const compare = event.compare;
        const commits = event.commits;
        const commitMessages = commits.map(c => `* [${c.message}](${c.url})`).join("\n");
        const branch = event.ref.replace("refs/heads/", "");
        if (commits.length === 0) {
            return null;
        }
        return `${author} 在[${project}](${compare}) ${branch}分支 push了${commits.length}个提交:\n${commitMessages}`;
    },
    pull_request: {
        opened: event => {
            const author = logins[event.pull_request.user.login] ?? event.pull_request.user.login;
            const project = event.repository.full_name;
            const url = event.pull_request.html_url;
            const title = event.pull_request.title;
            const body = event.pull_request.body;
            const head = event.pull_request.head.ref;
            const base = event.pull_request.base.ref;
            const commits = event.pull_request.commits;
            return `${author} 在[${project}](${url}) 想要将${commits}个提交从${head}合并到${base}\n >Title:${title}\n >Body:${body}`;
        },
    },
    check_run: {
        completed: event => {
            const projectName = event.repository.name;
            const project = event.repository.full_name;
            const url = event.repository.html_url;
            const release = event.check_run.check_suite.head_branch;
            const author = logins[event.sender.login] ?? event.sender.login;
            return `${author} 在[${project}](${url}) 部署 ${projectName}${release}版本 成功`;
        },
    },
};

export const notify = (key, event) => {
    const eventType = events?.[key];
    const handler = event.action != null ? eventType?.[event.action] : eventType;
    console.log(key, "key", event?.action, "event.action");
    if (typeof handler === "function") {
        const data = handler(event);
        if (data != null) {
            return wechatWebhook(DEVELOPERS_CHAT_BOT_KEY, {
                msgtype: "markdown",
                markdown: {
                    content: data,
                },
            });
        }
    }
};
