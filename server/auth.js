// Teacher accounts: scrypt password hashes + random session tokens in an HttpOnly cookie.
import { scrypt as _scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { HttpError, sha256 } from "./http.js";

const scrypt = promisify(_scrypt);
const COOKIE = "sb_session";
const SESSION_DAYS = 14;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

export async function verifyPassword(password, stored) {
  const [saltHex, keyHex] = stored.split(":");
  const expected = Buffer.from(keyHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(expected, actual);
}

function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export async function startSession(db, res, req, userId) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await db.run("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)", [sha256(token), userId, expires]);
  if (Math.random() < 0.1) await db.run("DELETE FROM sessions WHERE expires_at < now()");
  const secure = req.secure || req.headers["x-forwarded-proto"] === "https";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure ? "; Secure" : ""}`
  );
}

export async function endSession(db, req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) await db.run("DELETE FROM sessions WHERE token_hash = ?", [sha256(token)]);
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

export async function currentTeacher(db, req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const row = await db.get(
    `SELECT u.id, u.email, u.display_name FROM sessions s
     JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > now()`,
    [sha256(token)]
  );
  return row ? { id: row.id, email: row.email, displayName: row.display_name } : null;
}

export function requireTeacher(db) {
  return async (req, _res, next) => {
    const user = await currentTeacher(db, req);
    if (!user) throw new HttpError(401, "Please log in first.");
    req.teacher = user;
    next();
  };
}

/** Very small in-memory limiter for login/register attempts (per server instance). */
export function attemptLimiter({ windowMs = 60_000, max = 10 } = {}) {
  const hits = new Map();
  return (req, _res, next) => {
    const now = Date.now();
    const key = req.ip;
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) throw new HttpError(429, "Too many attempts. Wait a minute and try again.");
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) hits.clear();
    next();
  };
}
