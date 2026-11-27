// Netlify Function: runs the whole StudyBuddy API (the same Express app, wrapped by serverless-http).
// Pages and assets are served by Netlify's CDN; netlify.toml sends /api/* here.
import express from "express";
import serverless from "serverless-http";
import { randomBytes } from "node:crypto";
import { openDb } from "../../server/db.js";
import { createApp } from "../../server/app.js";

const FUNCTION_PREFIX = "/.netlify/functions/api";

export function createHandler({ db } = {}) {
  // Netlify limits how long one request may run, so the AI gets a shorter leash than on a normal server.
  process.env.GEMINI_PRIMARY_TIMEOUT_MS ??= "10000";
  process.env.GEMINI_FALLBACK_TIMEOUT_MS ??= "18000";

  const hasDatabaseSetting = Boolean(process.env.DATABASE_URL || process.env.NETLIFY_DB_URL);
  const database = db ?? (hasDatabaseSetting ? openDb() : null);

  const outer = express();
  outer.disable("x-powered-by");
  // Accept both /api/... and /.netlify/functions/api/... whichever way Netlify reports the path.
  outer.use((req, _res, next) => {
    if (req.url.startsWith(FUNCTION_PREFIX)) req.url = "/api" + req.url.slice(FUNCTION_PREFIX.length);
    next();
  });

  if (!database) {
    // A clear message instead of a crash when the site owner hasn't connected the database yet.
    outer.use((_req, res) =>
      res.status(503).json({ ok: false, database: false, error: "The site owner still needs to connect a database (the DATABASE_URL setting)." })
    );
  } else {
    if (!process.env.SESSION_SECRET) console.warn("! SESSION_SECRET is not set: the daily AI limit can't recognise visitors across restarts.");
    const limit = process.env.DAILY_AI_LIMIT === undefined ? 300 : Math.max(0, Number(process.env.DAILY_AI_LIMIT) || 0);
    outer.use(
      createApp({
        db: database,
        config: {
          serveSite: false,
          trustProxy: true,
          sessionSecret: process.env.SESSION_SECRET || randomBytes(32).toString("hex"),
          dailyAiLimit: limit,
          clientIpHeader: "x-nf-client-connection-ip", // set by Netlify itself, so visitors can't forge it
        },
      })
    );
  }
  return serverless(outer);
}

export const handler = createHandler();
