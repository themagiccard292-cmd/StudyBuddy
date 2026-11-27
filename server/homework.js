// Homework questions: validation for what teachers save, and cleaning for what the AI drafts.
import { HttpError, newId, shuffle } from "./http.js";

const clean = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Strict check of teacher-edited questions. Throws a friendly 400 on the first problem. */
export function validateHomework(list) {
  if (!Array.isArray(list) || list.length > 40) throw new HttpError(400, "A homework can have up to 40 questions.");
  return list.map((q, i) => {
    const n = i + 1;
    const type = q?.type === "mc" ? "mc" : q?.type === "short" ? "short" : null;
    if (!type) throw new HttpError(400, `Question ${n}: pick multiple choice or short answer.`);
    const question = clean(q.question, 2000);
    if (!question) throw new HttpError(400, `Question ${n} is empty.`);
    const points = Number(q.points);
    if (!Number.isFinite(points) || points < 0 || points > 100) throw new HttpError(400, `Question ${n}: points must be 0 to 100.`);
    const out = {
      id: clean(q.id, 40) || newId(),
      type,
      topic: clean(q.topic, 60) || "General",
      question,
      explanation: clean(q.explanation, 1500),
      points,
    };
    if (type === "mc") {
      const choices = Array.isArray(q.choices) ? q.choices.map((c) => clean(c, 500)) : [];
      if (choices.length !== 4 || choices.some((c) => !c)) throw new HttpError(400, `Question ${n}: fill in all 4 choices.`);
      if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex > 3) {
        throw new HttpError(400, `Question ${n}: mark the correct choice.`);
      }
      return { ...out, choices, correctIndex: q.correctIndex, answer: choices[q.correctIndex] };
    }
    const answer = clean(q.answer, 2000);
    if (!answer) throw new HttpError(400, `Question ${n}: add a model answer so it can be graded.`);
    return { ...out, answer };
  });
}

/** Lenient cleaning of AI-drafted questions: drop the broken ones. */
export function cleanDraft(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const q of list.slice(0, 40)) {
    const base = {
      id: newId(),
      topic: clean(q?.topic, 60) || "General",
      question: clean(q?.question, 2000),
      explanation: clean(q?.explanation, 1500),
    };
    if (base.question.length < 2) continue;
    const pts = Number(q.points);
    if (q.type === "mc") {
      const choices = Array.isArray(q.choices) ? q.choices.map((c) => clean(c, 500)).filter(Boolean) : [];
      if (choices.length !== 4 || !Number.isInteger(q.correctIndex) || !choices[q.correctIndex]) continue;
      const correct = choices[q.correctIndex];
      const shuffled = shuffle(choices);
      out.push({ ...base, type: "mc", choices: shuffled, correctIndex: shuffled.indexOf(correct), answer: correct, points: pts > 0 ? pts : 1 });
    } else {
      const answer = clean(q?.answer, 2000);
      if (!answer) continue;
      out.push({ ...base, type: "short", answer, points: pts > 0 ? pts : 2 });
    }
  }
  return out.length ? out : null;
}

export const totalPoints = (questions) => questions.reduce((n, q) => n + q.points, 0);

/** What a student may see while doing homework: no answer key. */
export function toPublic({ answer, correctIndex, explanation, ...rest }) {
  return rest;
}
