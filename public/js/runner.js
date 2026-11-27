// The one-question-at-a-time engine used by Quiz, Practice problems and weak-spot practice.
// Flow per question: try it -> wrong answers get a hint (never the answer) -> after a couple of tries
// (or on request) the answer + a short explanation is shown. First-try accuracy drives weak spots.
import { h, mount, icon, spinner, skeleton } from "./dom.js";
import { rich, richInline } from "./rich.js";
import { api } from "./api.js";
import { study } from "./store.js";

const LETTERS = ["A", "B", "C", "D"];

export function createRunner({ kind, count, mix, focusTopics = [], difficulty = "standard", onAgain, onExit }) {
  const root = h("div", { "aria-live": "polite" });
  let phase = "loading"; // loading | question | summary | error
  let error = "";
  let questions = [];
  let index = 0;
  const outcomes = [];
  let qs; // per-question state

  const resetQuestion = () => {
    qs = { attempts: 0, hints: 0, struck: [], selected: null, answer: "", feedback: null, resolved: null, checking: false, error: "", shake: false };
  };
  resetQuestion();

  async function generate() {
    phase = "loading";
    draw();
    const v = study.view();
    try {
      const res = await api.post("/api/ai/quiz", { notes: v.notesText, kind, count, mix, focusTopics: focusTopics.slice(0, 10), avoid: v.recentQuestions.slice(-20), difficulty });
      questions = res.questions;
      study.rememberQuestions(questions.map((q) => q.question.slice(0, 200)));
      phase = "question";
    } catch (e) {
      error = e.message;
      phase = "error";
    }
    draw();
  }

  function finish(ok, how, fb) {
    const q = questions[index];
    study.recordAnswer(q.topic, ok);
    outcomes.push({ topic: q.topic, question: q.question, ok });
    qs.resolved = how;
    qs.feedback = fb;
    draw();
  }

  const reveal = () => finish(false, "revealed", { tone: "reveal", text: questions[index].explanation || "Here's the answer. Read it, then try the next one." });

  function nudge(text, hint) {
    qs.shake = true;
    qs.feedback = { tone: "nudge", text, hint };
    draw();
  }

  function submitChoice() {
    const q = questions[index];
    if (qs.selected === null || qs.resolved) return;
    if (qs.selected === q.correctIndex) return finish(qs.attempts === 0, "right", { tone: "good", text: q.explanation || "That's right." });
    qs.attempts++;
    qs.struck.push(qs.selected);
    qs.selected = null;
    if (qs.struck.length >= 3) return finish(false, "revealed", { tone: "reveal", text: q.explanation }); // only the right one is left
    nudge("Not quite. That one's crossed off, try again.", q.hints[Math.min(qs.attempts - 1, q.hints.length - 1)]);
  }

  async function submitText() {
    const q = questions[index];
    if (qs.resolved || !qs.answer.trim() || qs.checking) return;
    qs.checking = true;
    qs.error = "";
    draw();
    try {
      const { results } = await api.post("/api/ai/check", {
        items: [{ id: q.id, question: q.question, reference: q.solution ? `${q.answer}\n(Worked solution: ${q.solution})` : q.answer, studentAnswer: qs.answer.trim() }],
        reveal: false,
      });
      const r = results[0];
      qs.checking = false;
      if (r.verdict === "correct") return finish(qs.attempts === 0, "right", { tone: "good", text: r.feedback || q.explanation });
      qs.attempts++;
      if (qs.attempts >= 3) return finish(false, "revealed", { tone: "reveal", text: q.explanation });
      nudge(r.feedback || "Close, but not quite yet.", r.hint || q.hints[Math.min(qs.attempts - 1, q.hints.length - 1)]);
    } catch (e) {
      qs.checking = false;
      qs.error = e.message;
      draw();
    }
  }

  const next = () => {
    resetQuestion();
    index++;
    phase = index >= questions.length ? "summary" : "question";
    draw();
  };

  function draw() {
    if (phase === "loading") {
      return mount(root, h("div", { class: "card run-card", "aria-busy": "true" }, h("div", { class: "row muted" }, spinner(), `Writing ${kind === "problems" ? "problems" : "questions"} from your notes…`), skeleton("1.6rem", "90%"), skeleton("1.6rem", "55%"), h("div", { class: "stack" }, skeleton("3.25rem"), skeleton("3.25rem"), skeleton("3.25rem"))));
    }
    if (phase === "error") {
      return mount(root, h("div", { class: "card run-card" }, h("h2", { class: "card-title" }, "Couldn't make questions"), h("p", { class: "muted" }, error), h("div", { class: "row" }, h("button", { class: "btn btn-primary", type: "button", onclick: onAgain }, icon("rotate-ccw"), "Try again"), h("button", { class: "btn btn-ghost", type: "button", onclick: onExit }, "Back"))));
    }
    if (phase === "summary") return mount(root, summary());

    const q = questions[index];
    const isChoice = q.type === "mc";
    const nextHint = qs.hints < q.hints.length;
    const canReveal = !qs.resolved && (qs.attempts >= 2 || !nextHint) && (qs.attempts >= 1 || qs.hints >= 1);
    const fb = qs.feedback;

    let checkBtn;
    let textarea;
    const body = isChoice
      ? h("div", { class: "choices", role: "radiogroup", "aria-label": "Choices" }, q.choices.map((c, i) => {
          const struck = qs.struck.includes(i);
          const right = qs.resolved && i === q.correctIndex;
          return h("button", { type: "button", role: "radio", "aria-checked": qs.selected === i, disabled: struck || Boolean(qs.resolved), class: `choice${qs.selected === i ? " sel" : ""}${struck ? " struck" : ""}${right ? " right" : ""}${struck && qs.shake ? " shake" : ""}`, onclick: () => ((qs.selected = i), draw()) }, h("span", { class: "letter" }, right ? icon("check", 16) : struck ? icon("x", 16) : LETTERS[i]), richInline(c));
        }))
      : (textarea = h("textarea", { class: "textarea", rows: q.type === "problem" ? 3 : 4, disabled: Boolean(qs.resolved) || qs.checking, placeholder: q.type === "problem" ? "Type your answer (show your work if you like)…" : "Type your answer in your own words…", "aria-label": "Your answer", value: qs.answer, oninput: (e) => ((qs.answer = e.target.value), checkBtn && (checkBtn.disabled = !qs.answer.trim() || qs.checking)), onkeydown: (e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), submitText()) }));

    const feedbackEl =
      fb &&
      h(
        "div",
        { class: `feedback ${fb.tone}`, role: "status" },
        h("div", { class: "feedback-icon" }, icon(fb.tone === "good" ? "circle-check" : fb.tone === "nudge" ? "lightbulb" : "eye", 22)),
        h(
          "div",
          { class: "feedback-body" },
          h("p", { class: "feedback-title" }, fb.tone === "good" ? (qs.attempts === 0 ? "Right!" : "You got it.") : fb.tone === "nudge" ? "Not yet" : "Here's the answer"),
          fb.tone === "reveal" && h("div", { class: "answer-line" }, rich(q.answer)),
          fb.text && rich(fb.text),
          fb.tone === "reveal" && q.solution && h("div", { class: "solution" }, h("b", null, "How to get there"), rich(q.solution)),
          fb.tone === "good" && q.type === "problem" && q.solution && h("div", { class: "solution" }, h("b", null, "Worked solution"), rich(q.solution)),
          fb.hint && h("p", { class: "hint-line" }, icon("lightbulb", 15), richInline(fb.hint))
        )
      );

    const actions = qs.resolved
      ? h("button", { class: "btn btn-primary btn-lg", type: "button", onclick: next }, index + 1 < questions.length ? "Next question" : "See my results", icon("arrow-right"))
      : [
          (checkBtn = h("button", { class: "btn btn-primary btn-lg", type: "button", disabled: isChoice ? qs.selected === null : !qs.answer.trim() || qs.checking, onclick: isChoice ? submitChoice : submitText }, qs.checking ? [spinner(), "Checking…"] : "Check answer")),
          nextHint && h("button", { class: "btn btn-outline btn-lg", type: "button", onclick: () => (qs.hints++, qs.feedback && (qs.feedback = { ...qs.feedback, hint: undefined }), draw()) }, icon("lightbulb"), "Give me a hint"),
          canReveal && h("button", { class: "btn btn-ghost btn-lg", type: "button", onclick: reveal }, icon("eye"), "Show me the answer"),
        ];

    mount(
      root,
      h(
        "div",
        { class: "card run-card" },
        h("div", { class: "progress-row" }, h("div", { class: "dots", role: "img", "aria-label": `Question ${index + 1} of ${questions.length}` }, questions.map((_, i) => h("span", { class: `dot${i < index ? " done" : ""}${i === index ? " now" : ""}` }))), h("span", { class: "muted small" }, `${index + 1} of ${questions.length}`), h("span", { class: "chip topic-chip" }, q.topic)),
        h("div", { class: "question" }, rich(q.question)),
        body,
        qs.error && h("p", { class: "form-error", role: "alert" }, qs.error),
        feedbackEl,
        !fb?.hint && qs.hints > 0 && !qs.resolved && h("p", { class: "hint-line" }, icon("lightbulb", 15), richInline(q.hints[qs.hints - 1])),
        h("div", { class: "row actions" }, actions)
      )
    );
    qs.shake = false;
    if (textarea && !qs.resolved && !qs.checking && qs.attempts > 0) textarea.focus();
  }

  function summary() {
    const right = outcomes.filter((o) => o.ok).length;
    const missed = [...new Set(outcomes.filter((o) => !o.ok).map((o) => o.topic))];
    const pct = outcomes.length ? Math.round((right / outcomes.length) * 100) : 0;
    const hasWeak = study.view().weakTopics.length > 0;
    return h(
      "div",
      { class: "card run-card" },
      h("div", { class: "row summary-top" }, h("div", { class: "score" }, h("b", null, right), h("span", { class: "muted" }, `of ${outcomes.length} on the first try`)), h("p", { class: "summary-note" }, pct === 100 ? "A perfect round. Nice work." : pct >= 70 ? "Strong round. A little more practice on the rest." : "Good effort. Those misses are exactly what to practice next.")),
      missed.length > 0 && h("div", { class: "stack" }, h("b", null, "Worth another look"), h("div", { class: "row" }, missed.map((t) => h("span", { class: "chip chip-miss" }, t)))),
      h("ul", { class: "recap" }, outcomes.map((o) => h("li", { class: o.ok ? "ok" : "miss" }, icon(o.ok ? "check" : "x", 16), richInline(o.question)))),
      h("div", { class: "row actions" }, h("button", { class: "btn btn-primary btn-lg", type: "button", onclick: onAgain }, icon("rotate-ccw"), "Another round"), hasWeak && h("a", { class: "btn btn-outline btn-lg", href: "/quiz?weak=1" }, icon("target"), "Practice my weak spots"), h("button", { class: "btn btn-ghost btn-lg", type: "button", onclick: onExit }, "Done"))
    );
  }

  generate();
  return root;
}
