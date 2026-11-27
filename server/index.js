import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { openDb } from "./db.js";
import { createApp } from "./app.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
try {
  process.loadEnvFile(join(root, ".env")); // optional: real environment variables win
} catch {
  /* no .env file: use the real environment */
}

if (!process.env.GEMINI_API_KEY) {
  console.warn("! GEMINI_API_KEY is not set. The site runs, but AI features will show a setup message.");
}
const sessionSecret =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET !== "change-me-to-a-long-random-string"
    ? process.env.SESSION_SECRET
    : randomBytes(32).toString("hex"); // fine for IP hashing; set SESSION_SECRET to keep it stable across restarts

const dailyAiLimit = process.env.DAILY_AI_LIMIT === undefined ? 300 : Math.max(0, Number(process.env.DAILY_AI_LIMIT) || 0);
const db = openDb({ path: process.env.DATABASE_PATH || join(root, "data", "pglite") });
const app = createApp({
  db,
  config: { sessionSecret, dailyAiLimit, trustProxy: process.env.TRUST_PROXY === "1" },
});

const port = Number(process.env.PORT) || 3000;
const server = app.listen(port, () => {
  console.log(`StudyBuddy is running at http://localhost:${port}`);
  console.log(dailyAiLimit ? `Daily AI limit: ${dailyAiLimit} calls per visitor` : "Daily AI limit: off");
  console.log(db.kind === "postgres" ? "Database: Postgres (DATABASE_URL)" : "Database: local files (no DATABASE_URL set)");
});

// Hosts (Render, Fly, Docker...) stop the app with SIGTERM on every deploy: finish in-flight requests, then close the database.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down`);
    server.close(async () => {
      await db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 8000).unref();
  });
}
process.on("unhandledRejection", (err) => console.error("Unhandled rejection:", err));
