import { v4 } from "uuid";

export const cacheStorage = (() => {
    const cache = {};
    return (key = v4()) => {
        if (cache[key] == null) {
            cache[key] = {};
        }
        return cache[key];
    }
})()
