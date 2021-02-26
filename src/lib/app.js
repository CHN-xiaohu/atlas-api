import compression from "compression";
import cors from "cors";
import express from "express";
import hsts from "hsts";
import httpServer from "http";

export const app = express(hsts({maxAge: 15552000}));

export const server = httpServer.createServer(app);

const IS_PRODUCTION = process.env.NODE_ENV === "production";

if (!IS_PRODUCTION) {
    app.use(compression());
}

app.use(cors());
