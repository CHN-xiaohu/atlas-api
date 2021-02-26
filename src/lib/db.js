import monk from "monk";

export const mongo = monk("localhost/ai");

export const id = monk.id;
