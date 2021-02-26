import {invalidate} from "./sockets";
import dayjs from "dayjs";
import objectHash from "object-hash";

export const advancedResponse = (status, data, headers = {}) => ({
    _isAdvancedResponse: true,
    status,
    data,
    headers,
});

const handleInvalidationHashes = hashesToInvalidate => {
    if (Array.isArray(hashesToInvalidate) && hashesToInvalidate.length > 0) {
        invalidate(hashesToInvalidate);
    }
};

export const isAPIMethod = method => {
    return typeof method === "object" && method.__isAPIMethod === true;
};

export const cached = (() => {
    const cache = {};
    return (fn, key, duration = 60 * 60 * 24) => {
        // eslint-disable-next-line immutable/no-let
        let localCache = cache[key];
        if (typeof localCache !== "object" || localCache == null) {
            cache[key] = {};
        }
        return async (...query) => {
            const queryHash = objectHash(query);
            // eslint-disable-next-line immutable/no-let
            let queryCache = localCache[queryHash];
            if (queryCache == null || typeof queryCache !== "object" || queryCache.expires.isAfter(dayjs())) {
                localCache[queryHash] = {
                    expires: dayjs().add(duration, "second"),
                    data: await fn(...query),
                };
            }
            return queryCache.data;
        };
    };
})();

export const protect = (access, action, hashesToInvalidate) => ({
    __isAPIMethod: true,
    public: async (data, user) => {
        if (typeof user !== "object") {
            console.warn(
                "Method called without providing user or lead object, please make sure you know what you are doing!",
            );
        }
        if (access(user, data)) {
            const result = await action(data, user);
            handleInvalidationHashes(hashesToInvalidate);
            return result;
        } else {
            console.warn("Access denied for", user?.login);
            return advancedResponse(403, {error: "Access denied"});
        }
    },
    private: action,
});

export const open = (action, hashesToInvalidate) => protect(() => true, action, hashesToInvalidate);

export const unsafe = (action, hashesToInvalidate) => async (...args) => {
    const result = await action(...args);
    handleInvalidationHashes(hashesToInvalidate);
    return result;
};

export const client = (access, action, hashesToInvalidate) => ({
    __isAPIMethod: true,
    public: async (data, user) => {
        if (access(user, data)) {
            const result = await action(data, user);
            handleInvalidationHashes(hashesToInvalidate);
            return result;
        } else {
            return advancedResponse(403, {error: "Access denied"});
        }
    },
    action,
    access
});

export const endpoint = ({...methods}, {...addons}) => {
    const addonsKeys = Object.keys(addons);
    const endpoint = {
        __isEndpoint: true,
        methods,
        ...addons,
    };
    return new Proxy(
        {},
        {
            get: (_target, prop) => {
                if (prop !== "methods" && !addonsKeys.includes(prop)) {
                    console.log(prop);
                }
                return endpoint[prop];
            },
        },
    );
};
