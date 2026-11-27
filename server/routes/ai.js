// Study endpoints for students: quiz, answer checking, explain-it-back, flashcards and chat.
import { Router } from "express";
import { geminiJson, callGemini } from "../gemini.js";
import { STUDY_SYSTEM, notesBlock } from "../prompts.js";
import { gradeAnswers } from "../grade.js";
import { HttpError, newId, shuffle, str, int, oneOf, list } from "../http.js";

const clean = (v, max = 400) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function normaliseQuestion(q, allowProblem) {
  if (!q || typeof q !== "object") return null;
  const base = {
    id: newId(),
    topic: clean(q.topic, 60) || "General",
    question: clean(q.question, 2000),
    hints: (Array.isArray(q.hints) ? q.hints : []).map((h) => clean(h, 400)).filter(Boolean).slice(0, 2),
    explanation: clean(q.explanation, 800),
  };
  if (base.question.length < 3) return null;
  if (q.type === "mc") {
    const choices = (Array.isArray(q.choices) ? q.choices : []).map((c) => clean(c, 300)).filter(Boolean);
    if (choices.length !== 4 || !Number.isInteger(q.correctIndex) || !choices[q.correctIndex]) return null;
    const correct = choices[q.correctIndex];
    const shuffled = shuffle(choices);
    return { ...base, type: "mc", choices: shuffled, correctIndex: shuffled.indexOf(correct), answer: correct };
  }
  const answer = clean(q.answer, 1000);
  if (!answer) return null;
  return {
    ...base,
    type: q.type === "problem" && allowProblem ? "problem" : "short",
    answer,
    solution: clean(q.solution, 1500) || undefined,
  };
}

export function aiRoutes({ limit }) {
  const r = Router();

  r.post("/quiz", async (req, res) => {
    const b = req.body ?? {};
    const notes = str(b.notes, { name: "Notes", min: 20, max: 300_000 });
    const kind = oneOf(b.kind, ["quiz", "test", "problems"], { name: "Kind" });
    const count = int(b.count, { name: "Count", min: 1, max: 15 });
    const mix = oneOf(b.mix, ["mixed", "mc", "short"], { name: "Mix", fallback: "mixed" });
    const difficulty = oneOf(b.difficulty, ["easier", "standard", "harder"], { name: "Level", fallback: "standard" });
    const focus = list(b.focusTopics, { name: "Topics", max: 10, optional: true }).map((t) => clean(t, 80)).filter(Boolean);
    const avoid = list(b.avoid, { name: "Earlier questions", max: 40, optional: true }).map((t) => clean(t, 300)).filter(Boolean);
    await limit.visitor(req);

    const problems = kind === "problems";
    const mixRule = problems
      ? `Every item is type "problem": a worked problem the student must solve (calculation, applied task, or a scenario to reason through, whatever fits the subject).`
      : mix === "mc"
        ? `Every item is type "mc".`
        : mix === "short"
          ? `Every item is type "short".`
          : `Mix about 60% type "mc" and 40% type "short".`;

    const prompt = `Write ${count} ${problems ? "practice problems" : kind === "test" ? "test questions" : "quiz questions"} from the notes below.

${mixRule}
Difficulty: ${difficulty}.
${focus.length ? `Focus on these weak topics: ${focus.join("; ")}.\n` : ""}${avoid.length ? `Do not repeat or closely copy these earlier questions:\n- ${avoid.join("\n- ")}\n` : ""}
Rules:
- Every item must be answerable from the notes. Never invent facts the notes don't support. If the notes are thin, write fewer items.
- "topic": a 1-4 word label for the concept being tested.
- type "mc": exactly 4 "choices", one correct, with distractors based on real misconceptions. "correctIndex" is 0-3. Never use "all of the above" or "none of the above". "answer" is the text of the correct choice.
- type "short": a question answerable in one or two sentences. "answer" is a model answer in one sentence.
- type "problem": "answer" is the final answer; "solution" is a short worked solution (max 5 short steps).
- "hints": exactly 2 progressive hints. The first nudges the student toward the idea; the second narrows it down. Neither may state the answer.
- "explanation": 1-2 simple sentences on why the answer is right.
- Use LaTeX in single dollar signs for math and chemistry formulas.

Reply with JSON only: {"questions":[{"type","topic","question","choices","correctIndex","answer","hints","explanation","solution"}]}

${notesBlock(notes)}`;

    const questions = await geminiJson(
      { system: STUDY_SYSTEM, messages: [{ role: "user", text: prompt }], temperature: 0.8 },
      (raw) => {
        if (!Array.isArray(raw?.questions)) throw new Error("questions must be a list");
        return raw.questions.map((q) => normaliseQuestion(q, problems)).filter(Boolean).slice(0, count);
      }
    );
    if (!questions.length) {
      throw new HttpError(502, "I couldn't make questions from those notes. Try adding a bit more detail.");
    }
    res.json({ questions });
  });

  r.post("/check", async (req, res) => {
    const b = req.body ?? {};
    const items = list(b.items, { name: "Answers", max: 15 }).map((it) => ({
      id: str(it?.id, { name: "id", min: 1, max: 40 }),
      question: str(it?.question, { name: "Question", min: 1, max: 1500 }),
      reference: str(it?.reference, { name: "Reference answer", min: 1, max: 2000 }),
      studentAnswer: str(it?.studentAnswer, { name: "Answer", max: 3000 }),
    }));
    if (!items.length) throw new HttpError(400, "Nothing to check.");
    await limit.visitor(req);
    res.json({ results: await gradeAnswers(items, b.reveal === true) });
  });

  r.post("/explain", async (req, res) => {
    const b = req.body ?? {};
    const notes = str(b.notes, { name: "Notes", max: 300_000, optional: true });
    const concept = str(b.concept, { name: "Concept", min: 2, max: 200 });
    const explanation = str(b.explanation, { name: "Your explanation", min: 15, max: 4000 });
    await limit.visitor(req);

    const hasNotes = notes.length > 20;
    const prompt = `The student is practicing "explain it back". They are explaining the concept below in their own words. Give kind, specific feedback.

Concept: ${concept}

<student_answer>${explanation}</student_answer>

${
  hasNotes
    ? `Use the notes as the source of truth. If the student says something the notes don't cover, say "your notes don't cover this" instead of calling it wrong.`
    : `The student has no notes loaded, so use well-established knowledge and keep it simple.`
}

Fill in:
- "topic": 1-4 word label for the concept.
- "verdict": "solid" (clear and essentially complete), "partly" (some right, something important missing), or "needs_work".
- "covered": up to 3 short points the student got right (always find something real to praise).
- "missing": up to 3 short points that are missing or unclear. Point to them as ideas to add, don't just recite the full answer.
- "mistakes": up to 3 things that are wrong. Quote or paraphrase what they said, then correct it gently in one sentence. Empty list if none.
- "encouragement": one warm sentence.
- "nextStep": one concrete thing to try next (for example a question to answer or an example to add).
Keep every item to one short sentence in simple language.

Reply with JSON only: {"topic","verdict","covered","missing","mistakes","encouragement","nextStep"}

${hasNotes ? notesBlock(notes) : ""}`;

    const strings = (v, n) => (Array.isArray(v) ? v.map((x) => clean(x, 400)).filter(Boolean).slice(0, n) : []);
    const feedback = await geminiJson(
      { system: STUDY_SYSTEM, messages: [{ role: "user", text: prompt }], temperature: 0.4 },
      (raw) => {
        if (!["solid", "partly", "needs_work"].includes(raw?.verdict)) throw new Error("verdict missing");
        return {
          topic: clean(raw.topic, 60) || concept,
          verdict: raw.verdict,
          covered: strings(raw.covered, 3),
          missing: strings(raw.missing, 3),
          mistakes: strings(raw.mistakes, 3),
          encouragement: clean(raw.encouragement, 300),
          nextStep: clean(raw.nextStep, 300),
        };
      }
    );
    res.json({ feedback });
  });

  r.post("/flashcards", async (req, res) => {
    const b = req.body ?? {};
    const notes = str(b.notes, { name: "Notes", min: 20, max: 300_000 });
    const count = int(b.count, { name: "Count", min: 4, max: 20 });
    const avoid = list(b.avoid, { name: "Earlier cards", max: 40, optional: true }).map((t) => clean(t, 200)).filter(Boolean);
    await limit.visitor(req);

    const prompt = `Make ${count} flashcards from the notes below that cover the most important ideas, terms, formulas and facts.

- "front": a short prompt, term or question.
- "back": the answer in 25 words or fewer, in simple language.
- "topic": a 1-4 word label.
- Only use what the notes support. Cover different parts of the notes.
${avoid.length ? `- Skip cards whose front matches any of these:\n  ${avoid.join("\n  ")}\n` : ""}
Reply with JSON only: {"cards":[{"front","back","topic"}]}

${notesBlock(notes)}`;

    const cards = await geminiJson(
      { system: STUDY_SYSTEM, messages: [{ role: "user", text: prompt }], temperature: 0.5 },
      (raw) => {
        if (!Array.isArray(raw?.cards)) throw new Error("cards must be a list");
        return raw.cards
          .filter((c) => clean(c?.front) && clean(c?.back))
          .slice(0, count)
          .map((c) => ({
            id: newId(),
            front: clean(c.front, 400),
            back: clean(c.back, 600),
            topic: clean(c.topic, 60) || "General",
          }));
      }
    );
    if (!cards.length) throw new HttpError(502, "I couldn't make flashcards from those notes.");
    res.json({ cards });
  });

  r.post("/chat", async (req, res) => {
    const b = req.body ?? {};
    const notes = str(b.notes, { name: "Notes", max: 300_000, optional: true });
    const messages = list(b.messages, { name: "Messages", max: 30 }).map((m) => ({
      role: oneOf(m?.role, ["user", "assistant"], { name: "Role" }),
      content: str(m?.content, { name: "Message", max: 4000 }),
    }));
    await limit.visitor(req);

    const hasNotes = notes.length > 20;
    const system = `${STUDY_SYSTEM}

You are in study chat.
${
  hasNotes
    ? `Answer using ONLY the student's notes below. If the notes don't cover the question, say "That isn't in your notes" and offer one next step (for example, adding that section to their notes). Only go beyond the notes if the student clearly asks you to (for example "use outside knowledge" or "ignore my notes"); when you do, begin that part with "Beyond your notes:".`
    : `The student hasn't added notes yet. Invite them to add notes for the best help, but you may still help with general study questions in a short answer.`
}
Keep replies short: usually 2-5 sentences. Ask a quick check-for-understanding question when it helps. If asked to write an essay or finish homework, kindly decline and offer to help them outline or understand the ideas instead. If asked for the answer to something they should try themselves, give a hint first.

${hasNotes ? notesBlock(notes, false) : ""}`;

    const recent = messages.slice(-16);
    while (recent.length && recent[0].role !== "user") recent.shift();
    if (!recent.length || recent.at(-1).role !== "user") throw new HttpError(400, "Say something first.");

    const reply = await callGemini({
      system,
      messages: recent.map((m) => ({
        role: m.role === "user" ? "user" : "model",
        text: m.role === "user" ? `<student_message>${m.content}</student_message>` : m.content,
      })),
      temperature: 0.6,
      maxOutputTokens: 1200,
    });
    res.json({ reply: reply.trim() });
  });

  return r;
}
