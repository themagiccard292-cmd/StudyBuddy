// Accounts: teachers sign up with an email; students with a username (no email, no real name needed).
import { Router } from "express";
import { HttpError, str, sha256 } from "../http.js";
import { isUniqueViolation } from "../db.js";
import {
  hashPassword, verifyPassword, verifyOrBurn, startSession, endSession, endSessionsFor, sessionToken,
  currentUser, attemptLimiter, loginGuard,
} from "../auth.js";

const USERNAME = /^[a-zA-Z0-9._-]{3,24}$/;
const FIRST_NAME = /^[\p{L}][\p{L}\p{M}' .-]*$/u;
const publicUser = (u) => ({ id: u.id, role: u.role, displayName: u.displayName, email: u.email ?? null, username: u.username ?? null });

export function authRoutes({ db, teacherAttemptsPerMinute = 12, studentAttemptsPerMinute = 120, guard = loginGuard() }) {
  const r = Router();
  // A whole class often shares one school IP address, so students get a roomier per-IP limit than teachers.
  const teacherLimiter = attemptLimiter({ max: teacherAttemptsPerMinute });
  const studentLimiter = attemptLimiter({ max: studentAttemptsPerMinute });

  // A guest who already joined a class on this device keeps it: the membership moves to the account
  // (unless the account is already in that class).
  const claimGuest = async (userId, token) => {
    if (typeof token !== "string" || !token) return false;
    const moved = await db.run(
      `UPDATE students SET user_id = ?, token_hash = NULL
       WHERE token_hash = ? AND user_id IS NULL
         AND NOT EXISTS (SELECT 1 FROM students x WHERE x.user_id = ? AND x.class_id = students.class_id)
       RETURNING id`,
      [userId, sha256(token), userId]
    );
    return moved.rows.length > 0;
  };

  // ---------- teachers ----------
  r.post("/register", teacherLimiter, async (req, res) => {
    const b = req.body ?? {};
    const email = str(b.email, { name: "Email", min: 3, max: 200 }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Enter a valid email address.");
    const displayName = str(b.displayName, { name: "Your name", min: 1, max: 60 });
    const password = str(b.password, { name: "Password", min: 8, max: 200, trim: false });
    const taken = new HttpError(409, "That email already has an account. Try logging in.");
    if (await db.get("SELECT 1 AS x FROM users WHERE lower(email) = ?", [email])) throw taken;
    let id;
    try {
      ({ id } = (await db.run("INSERT INTO users (email, display_name, password_hash, role) VALUES (?, ?, ?, 'teacher') RETURNING id", [email, displayName, await hashPassword(password)])).rows[0]);
    } catch (e) {
      if (isUniqueViolation(e)) throw taken; // two sign-ups for one address at the same moment
      throw e;
    }
    await startSession(db, res, req, id);
    res.status(201).json({ user: { id, role: "teacher", displayName, email, username: null } });
  });

  r.post("/login", teacherLimiter, async (req, res) => {
    const b = req.body ?? {};
    const email = str(b.email, { name: "Email", min: 1, max: 200 }).toLowerCase();
    const password = str(b.password, { name: "Password", min: 1, max: 200, trim: false });
    guard.check(`t:${email}`);
    const row = await db.get("SELECT id, email, display_name, password_hash FROM users WHERE lower(email) = ? AND role = 'teacher'", [email]);
    // Same message whether the email or the password was wrong.
    if (!(await verifyOrBurn(password, row?.password_hash))) {
      guard.fail(`t:${email}`);
      throw new HttpError(401, "That email or password isn't right.");
    }
    guard.ok(`t:${email}`);
    await startSession(db, res, req, row.id);
    res.json({ user: { id: row.id, role: "teacher", displayName: row.display_name, email: row.email, username: null } });
  });

  // ---------- students ----------
  r.post("/student/register", studentLimiter, async (req, res) => {
    const b = req.body ?? {};
    const username = str(b.username, { name: "Username", min: 3, max: 24 });
    if (!USERNAME.test(username)) throw new HttpError(400, "Usernames can use letters, numbers, dots, dashes and underscores (3 to 24 characters, no spaces).");
    const firstName = str(b.firstName, { name: "First name", min: 1, max: 30 });
    if (!FIRST_NAME.test(firstName)) throw new HttpError(400, "Use letters only for your first name.");
    const password = str(b.password, { name: "Password", min: 8, max: 200, trim: false });
    const taken = new HttpError(409, "That username is taken. Try another one.");
    if (await db.get("SELECT 1 AS x FROM users WHERE lower(username) = lower(?)", [username])) throw taken;
    let id;
    try {
      ({ id } = (await db.run("INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, 'student') RETURNING id", [username, firstName, await hashPassword(password)])).rows[0]);
    } catch (e) {
      if (isUniqueViolation(e)) throw taken;
      throw e;
    }
    const claimed = await claimGuest(id, b.guestToken);
    await startSession(db, res, req, id);
    res.status(201).json({ user: { id, role: "student", displayName: firstName, email: null, username }, claimedClass: claimed });
  });

  r.post("/student/login", studentLimiter, async (req, res) => {
    const b = req.body ?? {};
    const username = str(b.username, { name: "Username", min: 1, max: 40 });
    const password = str(b.password, { name: "Password", min: 1, max: 200, trim: false });
    guard.check(`s:${username}`);
    // Lower-case in JS, the same way the lockout key is made: Postgres' lower() also folds some non-ASCII letters
    // (lower('İ') = 'i'), which would let "kİm" reach kim's account under a different lockout key.
    const row = await db.get("SELECT id, username, display_name, password_hash FROM users WHERE lower(username) = ? AND role = 'student'", [username.toLowerCase()]);
    if (!(await verifyOrBurn(password, row?.password_hash))) {
      guard.fail(`s:${username}`);
      throw new HttpError(401, "That username or password isn't right.");
    }
    guard.ok(`s:${username}`);
    const claimed = await claimGuest(row.id, b.guestToken);
    await startSession(db, res, req, row.id);
    res.json({ user: { id: row.id, role: "student", displayName: row.display_name, email: null, username: row.username }, claimedClass: claimed });
  });

  // ---------- both ----------
  r.post("/logout", async (req, res) => {
    await endSession(db, req, res);
    res.json({ ok: true });
  });

  r.get("/me", async (req, res) => {
    const user = await currentUser(db, req);
    res.json({ user: user ? publicUser(user) : null });
  });

  r.post("/password", studentLimiter, async (req, res) => {
    const user = await currentUser(db, req);
    if (!user) throw new HttpError(401, "Please log in first.");
    const current = str(req.body?.current, { name: "Current password", min: 1, max: 200, trim: false });
    const next = str(req.body?.next, { name: "New password", min: 8, max: 200, trim: false });
    const row = await db.get("SELECT password_hash FROM users WHERE id = ?", [user.id]);
    guard.check(`p:${user.id}`);
    if (!(await verifyPassword(current, row.password_hash))) {
      guard.fail(`p:${user.id}`);
      throw new HttpError(400, "Your current password isn't right.");
    }
    guard.ok(`p:${user.id}`);
    await db.run("UPDATE users SET password_hash = ? WHERE id = ?", [await hashPassword(next), user.id]);
    await endSessionsFor(db, user.id, sessionToken(req)); // other devices must log in again
    res.json({ ok: true });
  });

  return r;
}
