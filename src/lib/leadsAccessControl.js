import { mongo, id } from "./db";

const leadsDB = mongo.get("leads");

export const availableLeads = async manager => {
    const leads = await leadsDB.find({ managers: manager }, { projection: { _id: 1 } });
    return leads.map(lead => id(lead._id));
};
