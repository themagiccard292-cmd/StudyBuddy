// Grades free-text answers against a model answer with Gemini.
import { geminiJson } from "./gemini.js";
import { STUDY_SYSTEM } from "./prompts.js";

const VERDICTS = ["correct", "partial", "incorrect"];

/** items: [{ id, question, reference, studentAnswer }] -> [{ id, verdict, feedback, hint }] */
export async function gradeAnswers(items, reveal) {
  const block = items
    .map(
      (it) =>
        `<item id="${it.id}">\nQuestion: ${it.question}\nModel answer: ${it.reference}\n<student_answer>${it.studentAnswer}</student_answer>\n</item>`
    )
    .join("\n");

  const prompt = `Check each student answer against the model answer.

Judge by meaning, not wording: accept correct answers phrased differently, with different but equivalent numbers/units/forms, or with small spelling slips. "partial" means the student got part of it. A blank or "I don't know" answer is "incorrect".
${
  reveal
    ? `For each item, "feedback" is 1-2 short, kind sentences saying whether it's right and WHY, and if it's wrong or partial, what the correct answer is. "hint" is an empty string.`
    : `The student is still trying, so for items that are not "correct" do NOT reveal the model answer. "feedback" is 1-2 short, kind sentences saying what's right so far and what to rethink. "hint" is one nudge that points toward the idea without stating the answer. For "correct" items, "feedback" says why it's right in 1-2 sentences and "hint" is an empty string.`
}

Reply with JSON only: {"results":[{"id","verdict":"correct"|"partial"|"incorrect","feedback","hint"}]}, one result per item, same ids.

${block}`;

  const out = await geminiJson(
    { system: STUDY_SYSTEM, messages: [{ role: "user", text: prompt }], temperature: 0.2 },
    (raw) => {
      if (!Array.isArray(raw?.results)) throw new Error("results must be a list");
      return raw.results
        .filter((r) => r && typeof r.id === "string" && VERDICTS.includes(r.verdict))
        .map((r) => ({
          id: r.id,
          verdict: r.verdict,
          feedback: typeof r.feedback === "string" ? r.feedback : "",
          hint: typeof r.hint === "string" ? r.hint : "",
        }));
    }
  );

  // Every requested item gets a result, even if the AI skipped one.
  const byId = new Map(out.map((r) => [r.id, r]));
  return items.map(
    (it) => byId.get(it.id) ?? { id: it.id, verdict: "incorrect", feedback: "I couldn't check this one. Try again.", hint: "" }
  );
}
