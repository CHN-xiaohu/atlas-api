import {endpoint, open} from "../lib/api-helper";
import Instagram from "instagram-web-api";

export const social = endpoint(
    {
        instagram: open(
            ({username}) => {
                const client = new Instagram({});
                return client.getUserByUsername({username})
            }
        )
    },
    {

    }
)
