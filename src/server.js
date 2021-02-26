import logTimestamp from "log-timestamp";
import "./cron.js";
import info from "../package.json";
import {server} from "./lib/app";
import "./lib/sockets";
import {set} from "./lib/socket-storage";
import "./lib/http";

set('version', info.version)

process.env.TZ = "Asia/Hong_Kong";

logTimestamp(() => {
    const date = new Date();
    return `[${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}]`;
});

server.listen(5000, () => {
    console.log(`Server version ${info.version} is listening on *:5000`);
});
