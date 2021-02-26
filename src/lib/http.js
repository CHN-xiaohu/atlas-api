import {app} from "./app"
import express from "express"
import connectors from "../http-connectors";
import {advancedResponse} from "./api-helper";

app.use("/files", express.static("files"));

const errorBoundary = (...args) => {
    const action = args[args.length - 1];
    return [
        ...args.slice(0, args.length - 1),
        (...args) => {
            try {
                return action(...args);
            } catch (e) {
                console.log(e);
                return advancedResponse(500, {error: "Server error", description: e.toString()});
            }
        },
    ];
};

connectors.get.forEach(connector => app.get(...errorBoundary(...connector)));
connectors.post.forEach(connector => app.post(...errorBoundary(...connector)));


