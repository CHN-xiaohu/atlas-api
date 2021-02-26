import {produce} from "immer";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

const createCloud = () => {
    // eslint-disable-next-line immutable/no-let
    let state = {};
    // eslint-disable-next-line immutable/no-let
    let listeners = {};
    const fire = (listener, key, value) => {
        if (listener == null) {
            Object.values(listeners).forEach(listener => listener(key, value, state));
        } else {
            listeners[listener](key, value, state);
        }
    };

    const subscribe = (key, listener) => {
        listeners = {
            ...listeners,
            [key]: listener,
        };
    };

    const unsubscribe = key => {
        listeners = Object.keys(listeners).reduce((acc, listener) => {
            if (key !== listener) {
                return {
                    ...acc,
                    listener: listeners[listener],
                };
            }
            return acc;
        }, {});
    };

    const get = key => {
        if (key == null) {
            return state;
        }
        return state[key];
    };

    const set = (key, value, silently = false) => {
        if (typeof value === "function") {
            console.warn("Functions will not be synced!!");
        }
        state = produce(state, draft => {
            draft[key] = value;
        });
        if (silently && !IS_PRODUCTION) {
            fire("logger", key, value);
        } else {
            fire(null, key, value);
        }
    };

    if (!IS_PRODUCTION) {
        subscribe("logger", (key, value) => console.log("[socket storage update]", key, value));
    }

    return {
        subscribe,
        unsubscribe,
        get,
        set,
        fire,
    };
};

export const {subscribe, get, set, unsubscribe, fire} = createCloud();
