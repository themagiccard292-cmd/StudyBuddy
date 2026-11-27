// Daily AI-call limit so costs stay under control. Visitors are identified by a salted hash of
// their IP address; the raw IP is never stored. DAILY_AI_LIMIT=0 turns the limit off.
import { createHash } from "node:crypto";
import { HttpError } from "./http.js";

const today = () => new Date().toISOString().slice(0, 10);

export function createLimiter(db, { secret, visitorLimit, teacherLimit = 1000, classLimit = 2000, clientIpHeader }) {
  const visitorKey = (req) => {
    // Only trust a client-IP header that the hosting platform sets (e.g. Netlify's); anyone could forge it otherwise.
    const ip = (clientIpHeader && req.headers[clientIpHeader]) || req.ip;
    return "v:" + createHash("sha256").update(`${ip}|${secret}`).digest("hex").slice(0, 32);
  };

  /** Count one AI call for `key`; throws a friendly 429 when the day's allowance is spent. */
  async function consume(key, limit) {
    if (!limit) return;
    const row = await db.get(
      `INSERT INTO ai_usage (visitor_key, day, calls) VALUES (?, ?, 1)
       ON CONFLICT (visitor_key, day) DO UPDATE SET calls = ai_usage.calls + 1
       RETURNING calls`,
      [key, today()]
    );
    if (Math.random() < 0.01) await db.run("DELETE FROM ai_usage WHERE day < CURRENT_DATE - 7");
    if (row.calls > limit) {
      throw new HttpError(429, `You've used today's ${limit} AI helps. They reset tomorrow, and your notes and progress are safe.`);
    }
  }

  return {
    visitor: (req) => consume(visitorKey(req), visitorLimit),
    teacher: (teacherId) => consume(`t:${teacherId}`, teacherLimit),
    classroom: (classId) => consume(`c:${classId}`, classLimit),
  };
}
