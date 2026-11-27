// Teacher accounts: scrypt password hashes + random session tokens in an HttpOnly cookie.
import { scrypt as _scrypt, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
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
  const [saltHex, keyHex] = String(stored).split(":");
  if (!saltHex || !keyHex) return false; // a damaged stored hash never matches (and never crashes the login)
  const expected = Buffer.from(keyHex, "hex");
  if (!expected.length) return false;
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

/** The logged-in account (teacher or student), or null. */
export async function currentUser(db, req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const row = await db.get(
    `SELECT u.id, u.email, u.username, u.display_name, u.role FROM sessions s
     JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > now()`,
    [sha256(token)]
  );
  return row ? { id: row.id, email: row.email, username: row.username, displayName: row.display_name, role: row.role } : null;
}

/** Route guard: only logged-in accounts with this role get through. */
export function requireRole(db, role, who) {
  return async (req, _res, next) => {
    const user = await currentUser(db, req);
    if (!user) throw new HttpError(401, "Please log in first.");
    if (user.role !== role) throw new HttpError(403, `${who} accounts only.`);
    req.user = user;
    if (role === "teacher") req.teacher = user;
    next();
  };
}
export const requireTeacher = (db) => requireRole(db, "teacher", "Teacher");

/** Log out everywhere for an account, optionally keeping one session (the one changing the password). */
export async function endSessionsFor(db, userId, exceptToken) {
  if (exceptToken) await db.run("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?", [userId, sha256(exceptToken)]);
  else await db.run("DELETE FROM sessions WHERE user_id = ?", [userId]);
}

export const sessionToken = (req) => parseCookies(req.headers.cookie)[COOKIE] ?? null;

// Checking a password for an account that doesn't exist still costs the same time, so response speed
// doesn't reveal which usernames or emails are registered.
let dummyHash;
export async function verifyOrBurn(password, stored) {
  if (stored) return verifyPassword(password, stored);
  dummyHash ??= await hashPassword("not-a-real-password");
  await verifyPassword(password, dummyHash);
  return false;
}

const TEMP_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no look-alike characters
export const temporaryPassword = () => Array.from({ length: 10 }, () => TEMP_ALPHABET[randomInt(TEMP_ALPHABET.length)]).join("");

/**
 * Keeps a limiter's map from growing forever without letting a flood of junk names wipe real lockouts: first drop
 * entries with nothing recent, then drop ones that are not locked (fewer than `max` recent tries), oldest first, and only
 * if everything left is locked drop the oldest of those.
 */
function prune(map, { windowMs, max }) {
  const now = Date.now();
  const recent = (times) => times.filter((t) => now - t < windowMs).length;
  for (const [k, v] of map) if (recent(v) === 0) map.delete(k);
  while (map.size > 4000) {
    let victim;
    for (const [k, v] of map) {
      victim ??= k; // fallback: the oldest
      if (recent(v) < max) {
        victim = k;
        break;
      }
    }
    map.delete(victim);
  }
}

/** Remembers failed logins per account name so a classmate can't guess someone's password forever. */
export function loginGuard({ max = 10, windowMs = 10 * 60_000 } = {}) {
  const fails = new Map();
  const recent = (key) => (fails.get(key) ?? []).filter((t) => Date.now() - t < windowMs);
  return {
    check(key) {
      if (recent(key.toLowerCase()).length >= max) throw new HttpError(429, "Too many wrong tries for that account. Wait ten minutes, or ask your teacher to reset the password.");
    },
    fail(key) {
      const k = key.toLowerCase();
      fails.set(k, [...recent(k), Date.now()]);
      if (fails.size > 5000) prune(fails, { windowMs, max });
    },
    ok(key) {
      fails.delete(key.toLowerCase());
    },
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
    if (hits.size > 5000) prune(hits, { windowMs, max });
    next();
  };
}
