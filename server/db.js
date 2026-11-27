// Postgres for everything.
//  - Hosted (Netlify, Render...): set DATABASE_URL to a Postgres connection string (Neon works well).
//  - Local / tests: with no DATABASE_URL it uses PGlite, a real Postgres that runs inside Node and keeps its
//    files in DATABASE_PATH (default data/pglite) or in memory (":memory:").
// Students never have accounts: a class join code plus a first name is all they give.
import { mkdirSync } from "node:fs";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower ON users (lower(email));
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS classes (
  id SERIAL PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subject TEXT,
  join_code TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS classes_teacher ON classes(teacher_id);
CREATE TABLE IF NOT EXISTS curricula (
  id SERIAL PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS curricula_class ON curricula(class_id);
CREATE TABLE IF NOT EXISTS students (
  id SERIAL PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS students_class ON students(class_id);
CREATE TABLE IF NOT EXISTS assignments (
  id SERIAL PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  curriculum_id INTEGER REFERENCES curricula(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  instructions TEXT,
  questions TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assignments_class ON assignments(class_id);
CREATE TABLE IF NOT EXISTS submissions (
  id SERIAL PRIMARY KEY,
  assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  answers TEXT NOT NULL DEFAULT '[]',
  results TEXT NOT NULL DEFAULT '[]',
  score DOUBLE PRECISION NOT NULL DEFAULT 0,
  max_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 1,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, student_id)
);
CREATE INDEX IF NOT EXISTS submissions_student ON submissions(student_id);
-- Accounts for students (username + password, no email) next to the teachers' email accounts.
-- These statements are safe to run on every start, and upgrade a database made by an earlier version.
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'teacher';
ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (lower(username)) WHERE username IS NOT NULL;
-- A "student" row is a membership in one class. Guests prove it with a private token; account holders with user_id.
ALTER TABLE students ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE students ALTER COLUMN token_hash DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS students_user_class ON students (user_id, class_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS students_user ON students (user_id);
CREATE TABLE IF NOT EXISTS ai_usage (
  visitor_key TEXT NOT NULL,
  day DATE NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (visitor_key, day)
);
`;

/** SQL in this app uses ? placeholders; Postgres wants $1, $2... */
const toPg = (sql) => {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
};

async function pgDriver(url) {
  const { default: pg } = await import("pg");
  // Small pool: serverless functions open their own connections, and hosted Postgres limits them.
  const pool = new pg.Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX) || 3, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000 });
  return { query: (sql, params) => pool.query(sql, params), exec: (sql) => pool.query(sql), close: () => pool.end() };
}

async function pgliteDriver(path) {
  const specifier = "@electric-sql/pglite"; // loaded only when no DATABASE_URL (keeps it out of serverless bundles)
  const { PGlite } = await import(specifier);
  const onDisk = path && path !== ":memory:";
  if (onDisk) mkdirSync(path, { recursive: true });
  const pglite = new PGlite(onDisk ? path : undefined);
  await pglite.waitReady;
  return {
    query: async (sql, params) => {
      const r = await pglite.query(sql, params);
      return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
    },
    exec: (sql) => pglite.exec(sql),
    close: () => pglite.close(),
  };
}

/**
 * Returns immediately; every call waits for the connection and the tables to be ready.
 * Options: { url, path }. Pass url: null to force the local PGlite database (tests).
 */
export function openDb(options = {}) {
  const url = "url" in options ? options.url : process.env.DATABASE_URL || process.env.NETLIFY_DB_URL;
  const path = options.path ?? process.env.DATABASE_PATH ?? "data/pglite";
  let driver;

  const ready = (async () => {
    driver = url ? await pgDriver(url) : await pgliteDriver(path);
    try {
      await driver.exec(SCHEMA);
    } catch (e) {
      // Two cold starts creating the tables at the same moment can collide once: try again.
      await new Promise((r) => setTimeout(r, 300));
      await driver.exec(SCHEMA);
    }
  })();
  ready.catch((e) => console.error("Database connection failed:", e.message));

  const db = {
    kind: url ? "postgres" : "pglite",
    /** Rows as objects with snake_case keys. */
    async all(sql, params = []) {
      await ready;
      return (await driver.query(toPg(sql), params)).rows;
    },
    async get(sql, params = []) {
      return (await db.all(sql, params))[0];
    },
    /** For INSERT/UPDATE/DELETE. `rows` holds RETURNING values. */
    async run(sql, params = []) {
      await ready;
      const r = await driver.query(toPg(sql), params);
      return { rows: r.rows, rowCount: r.rowCount ?? 0 };
    },
    async close() {
      await ready.catch(() => {});
      await driver?.close();
    },
    ready,
  };
  return db;
}

export const isUniqueViolation = (e) => e?.code === "23505";
