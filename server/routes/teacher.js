// Teacher side: accounts, classes, curricula, AI-assisted homework and results.
import { Router } from "express";
import { randomInt } from "node:crypto";
import { HttpError, str, int, oneOf, list, camel } from "../http.js";
import { isUniqueViolation } from "../db.js";
import { hashPassword, requireTeacher, endSessionsFor, temporaryPassword } from "../auth.js";
import { geminiJson } from "../gemini.js";
import { TEACHER_SYSTEM, HOMEWORK_JSON_SHAPE, NOTES_MAX_CHARS } from "../prompts.js";
import { validateHomework, cleanDraft, totalPoints } from "../homework.js";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I, easy to read aloud
const joinCode = () => Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
const parse = (text) => JSON.parse(text);

export function teacherRoutes({ db, limit, guard }) {
  const r = Router();
  r.use(requireTeacher(db));

  const ownedClass = async (id, teacherId) => {
    const row = await db.get("SELECT * FROM classes WHERE id = ? AND teacher_id = ?", [id, teacherId]);
    if (!row) throw new HttpError(404, "Class not found.");
    return row;
  };
  const ownedHomework = async (id, teacherId) => {
    const row = await db.get(
      `SELECT a.*, c.name AS class_name FROM assignments a JOIN classes c ON c.id = a.class_id
       WHERE a.id = ? AND c.teacher_id = ?`,
      [id, teacherId]
    );
    if (!row) throw new HttpError(404, "Homework not found.");
    return row;
  };

  // ---- classes ----
  r.get("/classes", async (req, res) => {
    const rows = await db.all(
      `SELECT c.id, c.name, c.subject, c.join_code,
         (SELECT COUNT(*)::int FROM students s WHERE s.class_id = c.id) AS student_count,
         (SELECT COUNT(*)::int FROM assignments a WHERE a.class_id = c.id) AS homework_count
       FROM classes c WHERE c.teacher_id = ? ORDER BY c.created_at DESC, c.id DESC`,
      [req.teacher.id]
    );
    res.json({ classes: rows.map(camel) });
  });

  r.post("/classes", async (req, res) => {
    const name = str(req.body?.name, { name: "Class name", min: 1, max: 80 });
    const subject = str(req.body?.subject, { name: "Subject", max: 60, optional: true });
    const { n } = await db.get("SELECT COUNT(*)::int AS n FROM classes WHERE teacher_id = ?", [req.teacher.id]);
    if (n >= 30) throw new HttpError(400, "You can have up to 30 classes.");
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = joinCode();
      try {
        const { rows } = await db.run("INSERT INTO classes (teacher_id, name, subject, join_code) VALUES (?, ?, ?, ?) RETURNING id", [req.teacher.id, name, subject || null, code]);
        return res.status(201).json({ id: rows[0].id, joinCode: code });
      } catch (e) {
        if (!isUniqueViolation(e)) throw e; // join-code collision: try another
      }
    }
    throw new HttpError(500, "Couldn't make a join code. Try again.");
  });

  r.get("/classes/:id", async (req, res) => {
    const cls = await ownedClass(int(req.params.id, { name: "Class" }), req.teacher.id);
    const [curricula, students, assignments, subs] = await Promise.all([
      db.all("SELECT id, title, LENGTH(content)::int AS chars, created_at FROM curricula WHERE class_id = ? ORDER BY id DESC", [cls.id]),
      db.all(
        `SELECT s.id, s.first_name, s.created_at, (s.user_id IS NOT NULL) AS has_login,
           (SELECT COUNT(*)::int FROM submissions x WHERE x.student_id = s.id) AS completed
         FROM students s WHERE s.class_id = ? ORDER BY lower(s.first_name)`,
        [cls.id]
      ),
      db.all("SELECT * FROM assignments WHERE class_id = ? ORDER BY id DESC", [cls.id]),
      db.all("SELECT assignment_id, score, max_score FROM submissions WHERE assignment_id IN (SELECT id FROM assignments WHERE class_id = ?)", [cls.id]),
    ]);
    const homework = assignments.map((a) => {
      const qs = parse(a.questions);
      const mine = subs.filter((s) => s.assignment_id === a.id);
      const pcts = mine.map((s) => (s.max_score > 0 ? (s.score / s.max_score) * 100 : 0));
      return {
        id: a.id,
        title: a.title,
        status: a.status,
        dueAt: a.due_at,
        questionCount: qs.length,
        totalPoints: totalPoints(qs),
        completed: mine.length,
        avgPercent: pcts.length ? Math.round(pcts.reduce((x, y) => x + y, 0) / pcts.length) : null,
      };
    });
    res.json({
      cls: { id: cls.id, name: cls.name, subject: cls.subject, joinCode: cls.join_code },
      curricula: curricula.map(camel),
      students: students.map(camel),
      homework,
    });
  });

  r.delete("/classes/:id", async (req, res) => {
    const cls = await ownedClass(int(req.params.id, { name: "Class" }), req.teacher.id);
    await db.run("DELETE FROM classes WHERE id = ?", [cls.id]); // students, curricula, homework, results cascade
    res.json({ ok: true });
  });

  // ---- student logins ----
  // Student accounts have no email, so the teacher is the recovery path: a new temporary password, shown once.
  r.post("/students/:id/reset-password", async (req, res) => {
    const row = await db.get(
      `SELECT s.id, s.user_id, u.username FROM students s
       JOIN classes c ON c.id = s.class_id JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND c.teacher_id = ?`,
      [int(req.params.id, { name: "Student" }), req.teacher.id]
    );
    if (!row) throw new HttpError(404, "That student doesn't have a login in your class.");
    const tempPassword = temporaryPassword();
    await db.run("UPDATE users SET password_hash = ? WHERE id = ?", [await hashPassword(tempPassword), row.user_id]);
    await endSessionsFor(db, row.user_id); // whoever was logged in with the old password is signed out
    guard?.ok(`s:${row.username}`); // the lockout message tells students to ask for a reset, so the reset lifts it
    res.json({ username: row.username, tempPassword });
  });

  // ---- curricula ----
  r.post("/classes/:id/curricula", async (req, res) => {
    const cls = await ownedClass(int(req.params.id, { name: "Class" }), req.teacher.id);
    const title = str(req.body?.title, { name: "Title", min: 1, max: 120 });
    const content = str(req.body?.content, { name: "Curriculum text", min: 50, max: 400_000 });
    const { rows } = await db.run("INSERT INTO curricula (class_id, title, content) VALUES (?, ?, ?) RETURNING id", [cls.id, title, content]);
    res.status(201).json({ id: rows[0].id });
  });

  r.delete("/curricula/:id", async (req, res) => {
    const row = await db.get(
      "SELECT cu.id FROM curricula cu JOIN classes c ON c.id = cu.class_id WHERE cu.id = ? AND c.teacher_id = ?",
      [int(req.params.id, { name: "Curriculum" }), req.teacher.id]
    );
    if (!row) throw new HttpError(404, "Curriculum not found.");
    await db.run("DELETE FROM curricula WHERE id = ?", [row.id]);
    res.json({ ok: true });
  });

  // ---- AI homework assistant ----
  r.post("/classes/:id/homework/chat", async (req, res) => {
    const cls = await ownedClass(int(req.params.id, { name: "Class" }), req.teacher.id);
    const b = req.body ?? {};
    const textbook = str(b.textbook, { name: "Textbook text", max: 400_000, optional: true });
    const messages = list(b.messages, { name: "Messages", max: 24 }).map((m) => ({
      role: oneOf(m?.role, ["user", "assistant"], { name: "Role" }),
      content: str(m?.content, { name: "Message", max: 4000 }),
    }));
    const draft = list(b.draft, { name: "Draft", max: 40, optional: true }).map((d) => ({
      type: d?.type === "mc" ? "mc" : "short",
      topic: str(d?.topic, { max: 60, optional: true }),
      question: str(d?.question, { max: 2000, optional: true }),
    }));
    let curriculum = "";
    if (b.curriculumId) {
      const cur = await db.get("SELECT title, content FROM curricula WHERE id = ? AND class_id = ?", [int(b.curriculumId, { name: "Curriculum" }), cls.id]);
      if (cur) curriculum = `<curriculum title="${cur.title}">\n${cur.content.slice(0, NOTES_MAX_CHARS)}\n</curriculum>`;
    }
    await limit.teacher(req.teacher.id);

    const system = `${TEACHER_SYSTEM}

Class: ${cls.name}${cls.subject ? ` (${cls.subject})` : ""}
${curriculum || "No curriculum is attached to this homework."}
${textbook ? `<textbook>\n${textbook.slice(0, NOTES_MAX_CHARS)}\n</textbook>` : ""}
${draft.length ? `Current draft (${draft.length} questions):\n${draft.map((d, i) => `${i + 1}. [${d.type}] ${d.topic}: ${d.question}`).join("\n")}` : "There is no draft yet."}

${HOMEWORK_JSON_SHAPE}`;

    const recent = messages.slice(-16);
    while (recent.length && recent[0].role !== "user") recent.shift();
    if (!recent.length || recent.at(-1).role !== "user") throw new HttpError(400, "Say what you'd like first.");

    const out = await geminiJson(
      {
        system,
        messages: recent.map((m) => ({
          role: m.role === "user" ? "user" : "model",
          text: m.role === "user" ? `<teacher_message>${m.content}</teacher_message>` : m.content,
        })),
        temperature: 0.6,
      },
      (raw) => {
        if (!raw || typeof raw !== "object") throw new Error("not an object");
        return raw;
      }
    );
    const questions = cleanDraft(out.questions);
    res.json({
      reply:
        (typeof out.reply === "string" && out.reply.trim()) ||
        (questions ? "Here's a draft. Tell me what to change." : "Tell me more about what you want."),
      title: typeof out.title === "string" && out.title.trim() ? out.title.trim().slice(0, 120) : null,
      instructions: typeof out.instructions === "string" && out.instructions.trim() ? out.instructions.trim().slice(0, 2000) : null,
      questions,
    });
  });

  // ---- homework ----
  const readHomework = async (body, cls) => {
    const title = str(body.title, { name: "Title", min: 1, max: 120 });
    const instructions = str(body.instructions, { name: "Instructions", max: 2000, optional: true });
    const status = oneOf(body.status, ["draft", "published"], { name: "Status" });
    const questions = validateHomework(body.questions);
    if (status === "published" && questions.length === 0) throw new HttpError(400, "Add at least one question before publishing.");
    let curriculumId = null;
    if (body.curriculumId) {
      curriculumId = int(body.curriculumId, { name: "Curriculum" });
      if (!(await db.get("SELECT 1 AS x FROM curricula WHERE id = ? AND class_id = ?", [curriculumId, cls.id]))) {
        throw new HttpError(400, "That curriculum isn't in this class.");
      }
    }
    let dueAt = null;
    if (body.dueAt) {
      const d = new Date(body.dueAt);
      if (Number.isNaN(d.getTime())) throw new HttpError(400, "That due date isn't valid.");
      dueAt = d.toISOString();
    }
    return { title, instructions: instructions || null, status, questions, curriculumId, dueAt };
  };

  r.post("/classes/:id/homework", async (req, res) => {
    const cls = await ownedClass(int(req.params.id, { name: "Class" }), req.teacher.id);
    const h = await readHomework(req.body ?? {}, cls);
    const { rows } = await db.run(
      "INSERT INTO assignments (class_id, curriculum_id, title, instructions, questions, status, due_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
      [cls.id, h.curriculumId, h.title, h.instructions, JSON.stringify(h.questions), h.status, h.dueAt]
    );
    res.status(201).json({ id: rows[0].id });
  });

  r.put("/homework/:id", async (req, res) => {
    const a = await ownedHomework(int(req.params.id, { name: "Homework" }), req.teacher.id);
    const h = await readHomework(req.body ?? {}, { id: a.class_id });
    await db.run(
      `UPDATE assignments SET curriculum_id = ?, title = ?, instructions = ?, questions = ?, status = ?, due_at = ?,
         updated_at = now() WHERE id = ?`,
      [h.curriculumId, h.title, h.instructions, JSON.stringify(h.questions), h.status, h.dueAt, a.id]
    );
    res.json({ id: a.id });
  });

  r.get("/homework/:id", async (req, res) => {
    const a = await ownedHomework(int(req.params.id, { name: "Homework" }), req.teacher.id);
    const { n } = await db.get("SELECT COUNT(*)::int AS n FROM submissions WHERE assignment_id = ?", [a.id]);
    res.json({
      id: a.id,
      classId: a.class_id,
      className: a.class_name,
      curriculumId: a.curriculum_id,
      title: a.title,
      instructions: a.instructions,
      status: a.status,
      dueAt: a.due_at,
      questions: parse(a.questions),
      submissionCount: n,
    });
  });

  r.delete("/homework/:id", async (req, res) => {
    const a = await ownedHomework(int(req.params.id, { name: "Homework" }), req.teacher.id);
    await db.run("DELETE FROM assignments WHERE id = ?", [a.id]);
    res.json({ ok: true });
  });

  r.get("/homework/:id/results", async (req, res) => {
    const a = await ownedHomework(int(req.params.id, { name: "Homework" }), req.teacher.id);
    const qs = parse(a.questions);
    const [students, subs] = await Promise.all([
      db.all("SELECT id, first_name FROM students WHERE class_id = ? ORDER BY lower(first_name)", [a.class_id]),
      db.all("SELECT * FROM submissions WHERE assignment_id = ?", [a.id]),
    ]);
    const byStudent = new Map(subs.map((s) => [s.student_id, s]));

    const rows = students.map((st) => {
      const s = byStudent.get(st.id);
      if (!s) {
        return { studentId: st.id, firstName: st.first_name, status: "not_started", score: 0, maxScore: totalPoints(qs), percent: null, attempts: 0, completedAt: null };
      }
      return {
        studentId: st.id,
        firstName: st.first_name,
        status: "completed",
        score: s.score,
        maxScore: s.max_score,
        percent: s.max_score > 0 ? Math.round((s.score / s.max_score) * 100) : 0,
        attempts: s.attempts,
        completedAt: s.completed_at,
      };
    });
    const done = rows.filter((x) => x.status === "completed");
    const allResults = subs.map((s) => parse(s.results));
    res.json({
      assignment: {
        id: a.id,
        classId: a.class_id,
        className: a.class_name,
        title: a.title,
        status: a.status,
        dueAt: a.due_at,
        questionCount: qs.length,
        totalPoints: totalPoints(qs),
      },
      students: rows,
      questions: qs.map((q) => {
        const items = allResults.map((r2) => r2.find((x) => x.id === q.id)).filter(Boolean);
        return {
          id: q.id,
          question: q.question,
          topic: q.topic,
          answered: items.length,
          percentCorrect: items.length ? Math.round((items.filter((x) => x.verdict === "correct").length / items.length) * 100) : null,
        };
      }),
      summary: {
        completed: done.length,
        total: rows.length,
        avgPercent: done.length ? Math.round(done.reduce((n, x) => n + (x.percent ?? 0), 0) / done.length) : null,
      },
    });
  });

  return r;
}
