import {mongo} from "../../lib/db";
import {print} from "../helper";
import {mapP} from "../../helper";

const leadDB = mongo.get("leads");
const userDB = mongo.get("users");

(async () => {
    const leads = await leadDB.find({managers: {$ne: null}});
    const users = await userDB.find({manager: {$ne: null}});

    mapP(async lead => {
        const login = await mapP(async manager => {
            return users.find(user => user.manager === manager)?.login;
        }, lead.managers);
        print(lead.managers, "lead.managers");
        print(login, "login");
        if (login.length !== 0) {
            await leadDB.update({managers: lead.managers}, {$set: {managers: login}});
        }
    }, leads);
})();
