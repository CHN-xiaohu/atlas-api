import {server} from "./app";
import {requestHandler} from "./api";
import {endpoints} from "./endpoints";
import {subscribe, set, get} from "./socket-storage";

import {Server} from "socket.io";
const IS_PRODUCTION = process.env.NODE_ENV === "production";

set("active-users", [], true);

export const io = new Server(server, {
    pingInterval: 10000,
    pingTimeout: 5000,
    cors: {
        origin: "*",
        credentials: true,
    },
});

const cache = {};

const getActiveUsers = () => {
    const sockets = Array.from(io.sockets.sockets.values()).filter(socket => socket.user != null);
    const users = sockets.map(socket => socket.user); //理论上不需要filter但是有时候没有user，不知道为何
    return [...new Set(users.map(user => user.login))];
};

subscribe("socket-gate", (key, value) => {
    io.sockets.in("users").emit("socket-storage-change", {
        key,
        value,
    });
});

io.on("connection", async socket => {
    !IS_PRODUCTION && console.log("socket", socket.id, "connected");
    const session = socket.handshake.query.session;
    const userId = socket.handshake.query.userId;
    if (socket.user == null && cache[session] == null && session != null) {
        cache[session] = endpoints.users.getUser(session);
    }

    if (socket.lead == null && cache[userId] == null && userId != null) {
        cache[userId] = endpoints.leads.checkClient(userId);
    }

    if (cache[userId] != null) {
        cache[userId].then(lead => {
            if (lead != null && socket.lead == null) {
                socket.join("clients");
                socket.join(userId);
                socket.lead = lead;
                !IS_PRODUCTION && console.log("client", lead._id, "connected");
            }
        });
    }

    if (cache[session] != null) {
        cache[session].then(user => {
            if (user != null && socket.user == null) {
                socket.join("users");
                socket.join(user.login);
                socket.user = user;
                socket.emit("socket-storage-replace", get());
                const activeUsers = getActiveUsers();
                if (get("active-users").length !== activeUsers.length) {
                    set("active-users", activeUsers);
                }
                !IS_PRODUCTION && console.log("user", socket.user.login, "connected");
            }
        });
    }

    socket.on("disconnect", reason => {
        !IS_PRODUCTION && console.log("socket", socket.id, "disconnected because", reason);
        if (socket.user != null) {
            const activeUsers = getActiveUsers();
            if (get("active-users").length !== activeUsers.length) {
                set("active-users", activeUsers);
            }
            !IS_PRODUCTION && console.log("user", socket.user.login, "disconnected because", reason);
        }
        if (socket.lead != null) {
            !IS_PRODUCTION && console.log("client", socket.lead._id, "disconnected because", reason);
        }
    });

    socket.on("request", ({endpoint, method, ...data}, respond) => {
        //console.log(endpoint, method)
        requestHandler(endpoint, method ?? "get", session ?? userId, data).then(result => {
            if (result?._isAdvancedResponse) {
                respond(result.data);
            } else {
                respond(result);
            }
        });
    });
});

export const invalidate = keys => {
    !IS_PRODUCTION && console.log("invalidate", keys);
    io.sockets.in("users").in("clients").emit("invalidate", keys);
};
