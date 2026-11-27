// Student side of classes. No accounts: a join code + first name gives the browser a private token.
import { Router } from "express";
import { randomBytes } from "node:crypto";
import { HttpError, sha256, str, int, list, camel } from "../http.js";
import { attemptLimiter } from "../auth.js";
import { gradeAnswers } from "../grade.js";
import { totalPoints, toPublic } from "../homework.js";

const MAX_STUDENTS = 200;
const parse = (t) => JSON.parse(t);

export function studentRoutes({ db, limit }) {
  const r = Router();

  r.post("/join", attemptLimiter({ max: 20 }), async (req, res) => {
    const code = str(req.body?.code, { name: "Class code", min: 1, max: 12 }).toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) throw new HttpError(400, "Class codes are 6 letters and numbers.");
    const firstName = str(req.body?.firstName, { name: "First name", min: 1, max: 30 });
    if (!/^[\p{L}][\p{L}\p{M}' .-]*$/u.test(firstName)) throw new HttpError(400, "Use letters only for your first name.");

    const cls = await db.get("SELECT id, name FROM classes WHERE join_code = ?", [code]);
    if (!cls) throw new HttpError(404, "No class has that code. Check it with your teacher.");
    const taken = new Set((await db.all("SELECT first_name FROM students WHERE class_id = ?", [cls.id])).map((s) => s.first_name.toLowerCase()));
    if (taken.size >= MAX_STUDENTS) throw new HttpError(400, "That class is full.");

    // Two students with the same first name get a number so the teacher can tell them apart.
    let name = firstName;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${firstName} (${n})`;

    const token = randomBytes(24).toString("base64url");
    await db.run("INSERT INTO students (class_id, first_name, token_hash) VALUES (?, ?, ?)", [cls.id, name, sha256(token)]);
    res.status(201).json({ token, classId: cls.id, className: cls.name, firstName: name });
  });

  // Everything below needs the student's token: Authorization: Bearer <token>
  r.use(async (req, _res, next) => {
    const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    if (!token) throw new HttpError(401, "Join your class first.");
    const st = await db.get(
      `SELECT s.id, s.first_name, c.id AS class_id, c.name AS class_name
       FROM students s JOIN classes c ON c.id = s.class_id WHERE s.token_hash = ?`,
      [sha256(token)]
    );
    if (!st) throw new HttpError(404, "We couldn't find you in that class. Join again with your class code.");
    req.student = { id: st.id, firstName: st.first_name, classId: st.class_id, className: st.class_name };
    next();
  });

  r.get("/class", async (req, res) => {
    const st = req.student;
    const [materials, assignments, subs] = await Promise.all([
      db.all("SELECT id, title, LENGTH(content)::int AS chars FROM curricula WHERE class_id = ? ORDER BY id", [st.classId]),
      db.all("SELECT * FROM assignments WHERE class_id = ? AND status = 'published' ORDER BY id DESC", [st.classId]),
      db.all("SELECT * FROM submissions WHERE student_id = ?", [st.id]),
    ]);
    const byAssignment = new Map(subs.map((s) => [s.assignment_id, s]));
    const homework = assignments.map((a) => {
      const qs = parse(a.questions);
      const s = byAssignment.get(a.id);
      return {
        id: a.id,
        title: a.title,
        instructions: a.instructions,
        dueAt: a.due_at,
        questionCount: qs.length,
        totalPoints: totalPoints(qs),
        submission: s ? { score: s.score, maxScore: s.max_score, completedAt: s.completed_at, attempts: s.attempts } : null,
      };
    });
    res.json({ className: st.className, firstName: st.firstName, materials: materials.map(camel), homework });
  });

  r.get("/materials/:id", async (req, res) => {
    const row = await db.get("SELECT title, content FROM curricula WHERE id = ? AND class_id = ?", [int(req.params.id, { name: "Material" }), req.student.classId]);
    if (!row) throw new HttpError(404, "That material isn't in your class.");
    res.json(row);
  });

  const published = async (id, classId) => {
    const a = await db.get("SELECT * FROM assignments WHERE id = ? AND class_id = ? AND status = 'published'", [id, classId]);
    if (!a) throw new HttpError(404, "That homework isn't available.");
    return a;
  };

  r.get("/homework/:id", async (req, res) => {
    const a = await published(int(req.params.id, { name: "Homework" }), req.student.classId);
    const sub = await db.get("SELECT * FROM submissions WHERE assignment_id = ? AND student_id = ?", [a.id, req.student.id]);
    res.json({
      assignment: { id: a.id, title: a.title, instructions: a.instructions, dueAt: a.due_at },
      questions: parse(a.questions).map(toPublic),
      // The answer key only appears after a student has handed the homework in.
      submission: sub
        ? { score: sub.score, maxScore: sub.max_score, attempts: sub.attempts, completedAt: sub.completed_at, answers: parse(sub.answers), results: parse(sub.results) }
        : null,
    });
  });

  r.post("/homework/:id/submit", async (req, res) => {
    const st = req.student;
    const a = await published(int(req.params.id, { name: "Homework" }), st.classId);
    const given = new Map(
      list(req.body?.answers, { name: "Answers", max: 40 }).map((x) => [str(x?.id, { name: "id", min: 1, max: 40 }), str(x?.answer, { name: "Answer", max: 3000 })])
    );
    const qs = parse(a.questions);

    // Multiple choice is graded here; short answers go to Gemini in one batch.
    const shortItems = qs
      .filter((q) => q.type === "short" && (given.get(q.id) ?? "") !== "")
      .map((q) => ({ id: q.id, question: q.question, reference: q.answer, studentAnswer: given.get(q.id) }));
    const graded = new Map();
    if (shortItems.length) {
      await limit.classroom(st.classId); // homework grading draws on the class's shared allowance
      for (const g of await gradeAnswers(shortItems, true)) graded.set(g.id, g);
    }

    const results = qs.map((q) => {
      const raw = given.get(q.id) ?? "";
      let verdict;
      let feedback;
      if (q.type === "mc") {
        verdict = raw !== "" && Number(raw) === q.correctIndex ? "correct" : "incorrect";
        feedback = q.explanation;
      } else if (raw === "") {
        verdict = "incorrect";
        feedback = q.explanation || "No answer was given.";
      } else {
        const g = graded.get(q.id);
        verdict = g?.verdict ?? "incorrect";
        feedback = g?.feedback || q.explanation;
      }
      const earned = verdict === "correct" ? q.points : verdict === "partial" ? q.points / 2 : 0;
      return { id: q.id, verdict, earned, points: q.points, feedback, correctAnswer: q.answer };
    });
    const score = results.reduce((n, x) => n + x.earned, 0);
    const maxScore = totalPoints(qs);
    const answers = qs.map((q) => ({ id: q.id, answer: given.get(q.id) ?? "" }));

    await db.run(
      `INSERT INTO submissions (assignment_id, student_id, answers, results, score, max_score)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (assignment_id, student_id) DO UPDATE SET answers = EXCLUDED.answers, results = EXCLUDED.results,
         score = EXCLUDED.score, max_score = EXCLUDED.max_score, attempts = submissions.attempts + 1, completed_at = now()`,
      [a.id, st.id, JSON.stringify(answers), JSON.stringify(results), score, maxScore]
    );

    res.json({ score, maxScore, results });
  });

  return r;
}
