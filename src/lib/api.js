import {endpoints} from "./endpoints";
import {advancedResponse, isAPIMethod} from "./api-helper";

const IS_DEVELOPMENT = process.env.NODE_ENV !== "production";

const cache = {};

const generateId = (() => {
    // eslint-disable-next-line immutable/no-let
    let id = 0;
    return () => {
        return id++;
    };
})();

const getAccessKey = async session => {
    if (typeof session === "string" && session.length === 64) { // A little bit hack to speed up session detection
        if (cache[session] == null) {
            cache[session] = await endpoints.users.getUser(session);
        }
        return cache[session];
    }
    if (typeof session === "string" && session.length === 24) {
        if (cache[session] == null) {
            cache[session] = await endpoints.leads.checkClient(session);
        }
        return cache[session];
    }
    return null;
};

export const requestHandler = async (endpoint, method, session, data) => {
    const module = endpoints[endpoint]?.methods;

    if (module == null || !Object.keys(module).includes(method) || typeof module[method].public !== "function") {
        return advancedResponse(404, {error: "API endpoint not found"});
    }

    if (!isAPIMethod(module[method])) {
        console.error("tried to react unsecure endpoint", endpoint, method);
        return advancedResponse(403, {error: "Requested endpoint is unsecure"});
    }

    const requestId = generateId();
    IS_DEVELOPMENT && console.time(`[${requestId}] ${endpoint}/${method}`);

    try {
        const accessKey = await getAccessKey(session);
        return await module[method].public(data, accessKey);
    } catch (e) {
        console.error(e);
        return advancedResponse(500, {
            error: "Server error",
            description: e.toString(),
        });
    } finally {
        IS_DEVELOPMENT && console.timeEnd(`[${requestId}] ${endpoint}/${method}`);
    }
};
