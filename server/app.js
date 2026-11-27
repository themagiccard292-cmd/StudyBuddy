import express from "express";
import compression from "compression";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { HttpError } from "./http.js";
import { createLimiter } from "./limit.js";
import { backupConfig } from "./backup.js";
import { aiRoutes } from "./routes/ai.js";
import { authRoutes, teacherRoutes } from "./routes/teacher.js";
import { studentRoutes } from "./routes/student.js";

// Everything (scripts, fonts, styles) is served from this site, so nothing about a student's visit goes to a third party.
// netlify.toml sends the same policy for the static files Netlify serves itself (a test keeps them identical).
export const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";

/**
 * config: { sessionSecret, dailyAiLimit, trustProxy, serveSite = true, clientIpHeader }
 *  - serveSite: false when a CDN serves the pages (Netlify) and this app only answers /api.
 */
export function createApp({ db, config }) {
  const app = express();
  const serveSite = config.serveSite !== false;
  app.disable("x-powered-by");
  if (serveSite) app.use(compression());
  if (config.trustProxy) app.set("trust proxy", 1);

  app.use((req, res, next) => {
    res.setHeader("Content-Security-Policy", CSP);
    if (req.secure) res.setHeader("Strict-Transport-Security", "max-age=15552000"); // only over HTTPS
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    next();
  });

  app.use(express.json({ limit: "1.5mb" }));

  // Cross-site request protection for anything that changes data. Our own pages send this header; another website
  // can't add a custom header to a request without the browser asking this server's permission first (it never grants it).
  // Cookies are also SameSite=Lax. This doesn't depend on Host/Origin headers, which differ between hosting platforms.
  app.use("/api", (req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.headers["x-requested-with"] !== "StudyBuddy") {
      throw new HttpError(403, "Request blocked.");
    }
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  const limit = createLimiter(db, {
    secret: config.sessionSecret,
    visitorLimit: config.dailyAiLimit,
    clientIpHeader: config.clientIpHeader,
  });

  app.get("/api/health", async (_req, res) => {
    let database = true;
    try {
      await db.get("SELECT 1 AS ok");
    } catch {
      database = false;
    }
    res.status(database ? 200 : 503).json({
      ok: database,
      database,
      aiConfigured: Boolean(process.env.GEMINI_API_KEY || backupConfig()),
      backupAiConfigured: Boolean(backupConfig()),
    });
  });
  app.use("/api/ai", aiRoutes({ limit }));
  app.use("/api/auth", authRoutes({ db }));
  app.use("/api/teacher", teacherRoutes({ db, limit }));
  app.use("/api/student", studentRoutes({ db, limit }));
  app.use("/api", (_req, _res, next) => next(new HttpError(404, "Not found.")));

  if (serveSite) {
    // Only needed when this app serves the pages itself. (Netlify bundles the function in a way where
    // import.meta is empty, so it must not be read when the module loads.)
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const nm = (...p) => join(root, "node_modules", ...p);
    // index.html carries %ORIGIN% placeholders (share previews need absolute URLs); fill them in per request.
    const indexTemplate = readFileSync(join(root, "public", "index.html"), "utf8");
    const renderIndex = (req) => {
      const host = req.get("host") ?? "";
      const safeHost = /^[a-z0-9.-]+(:\d+)?$/i.test(host) ? host : "localhost"; // never reflect odd Host headers
      return indexTemplate.replaceAll("%ORIGIN%", `${req.protocol}://${safeHost}`);
    };

    // Third-party libraries are served from this site (no CDN requests).
    const opts = { maxAge: "7d", immutable: true };
    app.use("/vendor/fontsource", express.static(nm("@fontsource"), opts));
    app.use("/vendor/katex", express.static(nm("katex", "dist"), opts));
    app.use("/vendor/pdfjs", express.static(nm("pdfjs-dist", "build"), opts));
    app.use(express.static(join(root, "public"), { maxAge: 0, etag: true, index: false }));

    // Single-page app: any other page URL gets index.html and the browser routes it.
    app.get("/{*splat}", (req, res, next) => {
      if (req.path.includes(".")) return next();
      res.type("html").send(renderIndex(req));
    });
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err?.type === "entity.too.large") return res.status(413).json({ error: "That's too much text at once. Try a smaller file." });
    if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "That request wasn't valid." });
    console.error("Unhandled error:", err);
    res.status(500).json({ error: "Something went wrong on our side. Try again." });
  });

  return app;
}
