// Resets a teacher's password when they are locked out (there is no email reset).
//   node scripts/reset-teacher-password.mjs teacher@school.org
// Uses DATABASE_URL (or local data/) from .env, prints a temporary password once, and signs the teacher out everywhere.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openDb } from "../server/db.js";
import { hashPassword, temporaryPassword } from "../server/auth.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
try {
  process.loadEnvFile(join(root, ".env"));
} catch {
  /* no .env: use the real environment */
}

const email = (process.argv[2] || "").trim().toLowerCase();
if (!email) {
  console.error("Usage: node scripts/reset-teacher-password.mjs teacher@email");
  process.exit(1);
}

const db = openDb({ path: process.env.DATABASE_PATH || join(root, "data", "pglite") });
try {
  const user = await db.get("SELECT id FROM users WHERE lower(email) = ? AND role = 'teacher'", [email]);
  if (!user) {
    console.error(`No teacher account with the email ${email}.`);
    process.exitCode = 1;
  } else {
    const temp = temporaryPassword();
    await db.run("UPDATE users SET password_hash = ? WHERE id = ?", [await hashPassword(temp), user.id]);
    await db.run("DELETE FROM sessions WHERE user_id = ?", [user.id]);
    console.log(`Temporary password for ${email}: ${temp}`);
    console.log("Log in with it, then change it on the Account page.");
  }
} finally {
  await db.close();
}
