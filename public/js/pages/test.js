import { h, mount, icon, spinner, skeleton } from "../dom.js";
import { rich, richInline } from "../rich.js";
import { study } from "../store.js";
import { api } from "../api.js";
import { studyLayout, modeHeader, needNotes, segmented, field } from "../ui.js";

const LETTERS = ["A", "B", "C", "D"];

function createTest({ count, difficulty, onAgain, onExit }) {
  const root = h("div", { class: "stack" });
  let phase = "loading";
  let error = "";
  let questions = [];
  const answers = {};
  let graded = null;
  let grading = false;
  let gradeError = "";

  async function generate() {
    const v = study.view();
    try {
      const res = await api.post("/api/ai/quiz", { notes: v.notesText, kind: "test", count, mix: "mixed", difficulty, avoid: v.recentQuestions.slice(-20) });
      questions = res.questions;
      study.rememberQuestions(questions.map((q) => q.question.slice(0, 200)));
      phase = "taking";
    } catch (e) {
      error = e.message;
      phase = "error";
    }
    draw();
  }

  async function submit() {
    const short = questions.filter((q) => q.type !== "mc" && (answers[q.id] ?? "").trim());
    grading = true;
    gradeError = "";
    draw();
    try {
      const byId = new Map();
      if (short.length) {
        const { results } = await api.post("/api/ai/check", { items: short.map((q) => ({ id: q.id, question: q.question, reference: q.answer, studentAnswer: answers[q.id].trim() })), reveal: true });
        results.forEach((r) => byId.set(r.id, r));
      }
      graded = questions.map((q) => {
        const raw = (answers[q.id] ?? "").trim();
        if (q.type === "mc") {
          const idx = raw === "" ? -1 : Number(raw);
          return { q, verdict: idx === q.correctIndex ? "correct" : "incorrect", yours: idx >= 0 ? q.choices[idx] : "", feedback: q.explanation };
        }
        const r = byId.get(q.id);
        return { q, verdict: raw === "" ? "incorrect" : (r?.verdict ?? "incorrect"), yours: raw, feedback: raw === "" ? q.explanation : (r?.feedback ?? q.explanation) };
      });
      graded.forEach((g) => study.recordAnswer(g.q.topic, g.verdict === "correct"));
      grading = false;
      phase = "done";
      draw();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      grading = false;
      gradeError = e.message;
      draw();
    }
  }

  function refreshProgress() {
    const n = questions.filter((x) => (answers[x.id] ?? "").trim() !== "").length;
    const fill = root.querySelector(".sticky-bar .meter-fill");
    if (fill) fill.style.width = `${(n / questions.length) * 100}%`;
    const label = root.querySelector(".sticky-bar .nowrap");
    if (label) label.textContent = `${n} of ${questions.length} answered`;
  }

  /** Select a choice without redrawing the whole test (keeps scroll position and typed answers). */
  function pick(btn, q, ci) {
    answers[q.id] = String(ci);
    [...btn.parentElement.children].forEach((b, i) => {
      b.classList.toggle("sel", i === ci);
      b.setAttribute("aria-checked", String(i === ci));
    });
    refreshProgress();
  }

  function draw() {
    if (phase === "loading") return mount(root, h("div", { class: "card stack" }, h("div", { class: "row muted" }, spinner(), "Building your test from your notes…"), skeleton("5rem"), skeleton("5rem"), skeleton("5rem")));
    if (phase === "error") return mount(root, h("div", { class: "card stack" }, h("h2", { class: "card-title" }, "Couldn't build the test"), h("p", { class: "muted" }, error), h("div", { class: "row" }, h("button", { class: "btn btn-primary", type: "button", onclick: onAgain }, icon("rotate-ccw"), "Try again"), h("button", { class: "btn btn-ghost", type: "button", onclick: onExit }, "Back"))));

    if (phase === "done") {
      const pts = graded.reduce((n, g) => n + (g.verdict === "correct" ? 1 : g.verdict === "partial" ? 0.5 : 0), 0);
      const score = Math.round((pts / graded.length) * 100);
      const right = graded.filter((g) => g.verdict === "correct").length;
      return mount(
        root,
        h("div", { class: "card stack" }, h("div", { class: "row summary-top" }, h("div", { class: "score" }, h("b", null, `${score}%`), h("span", { class: "muted" }, `${right} of ${graded.length} fully right`)), h("p", { class: "summary-note" }, score >= 85 ? "Excellent. You know this material." : score >= 60 ? "Solid. Review the ones you missed below." : "A useful baseline. The review below shows what to study next.")), h("div", { class: "row" }, h("button", { class: "btn btn-primary btn-lg", type: "button", onclick: onAgain }, icon("rotate-ccw"), "New test"), h("button", { class: "btn btn-ghost btn-lg", type: "button", onclick: onExit }, "Done"))),
        graded.map((g, i) =>
          h("article", { class: `card review ${g.verdict}` }, h("div", { class: "row" }, h("span", { class: "num" }, i + 1), h("span", { class: `chip ${g.verdict === "correct" ? "chip-ok" : g.verdict === "partial" ? "chip-mark" : "chip-miss"}` }, icon(g.verdict === "correct" ? "check" : g.verdict === "partial" ? "circle-dot" : "x", 14), g.verdict === "correct" ? "Right" : g.verdict === "partial" ? "Partly right" : "Missed"), h("span", { class: "chip topic-chip" }, g.q.topic)), h("div", { class: "question q-sm" }, rich(g.q.question)), h("p", null, h("b", null, "Your answer: "), g.yours ? richInline(g.yours) : h("i", null, "No answer")), g.verdict !== "correct" && h("p", null, h("b", null, "Correct answer: "), richInline(g.q.answer)), g.feedback && h("div", { class: "why" }, rich(g.feedback)))
        )
      );
    }

    const answered = questions.filter((q) => (answers[q.id] ?? "").trim() !== "").length;
    const meter = h("div", { class: "meter" }, h("div", { class: "meter-fill", style: { width: `${(answered / questions.length) * 100}%` } }));
    mount(
      root,
      h("div", { class: "sticky-bar" }, h("span", { class: "nowrap" }, `${answered} of ${questions.length} answered`), meter, h("button", { class: "btn btn-primary", type: "button", disabled: grading, onclick: submit }, grading ? [spinner(), "Grading…"] : [icon("send-horizontal"), "Submit test"])),
      questions.map((q, i) =>
        h(
          "article",
          { class: "card" },
          h("div", { class: "row" }, h("span", { class: "num" }, i + 1), h("span", { class: "chip topic-chip" }, q.topic)),
          h("div", { class: "question q-sm" }, rich(q.question)),
          q.type === "mc"
            ? h("div", { class: "choices", role: "radiogroup", "aria-label": `Question ${i + 1} choices` }, q.choices.map((c, ci) => h("button", { type: "button", role: "radio", "aria-checked": answers[q.id] === String(ci), class: `choice${answers[q.id] === String(ci) ? " sel" : ""}`, onclick: (e) => pick(e.currentTarget, q, ci) }, h("span", { class: "letter" }, LETTERS[ci]), richInline(c))))
            : h("textarea", { class: "textarea", rows: 3, placeholder: "Your answer…", "aria-label": `Answer to question ${i + 1}`, value: answers[q.id] ?? "", oninput: (e) => ((answers[q.id] = e.target.value), refreshProgress()) })
        )
      ),
      gradeError && h("p", { class: "form-error", role: "alert" }, gradeError)
    );
  }
  draw();
  generate();
  return root;
}

export default function TestPage(ctx) {
  document.title = "Take a test | StudyBuddy";
  const content = h("div");
  let running = null;
  let round = 0;

  function draw() {
    const head = modeHeader({ title: "Take a test", blurb: "A full test from your notes. No hints this time: answer everything, then see how you did.", ic: "clipboard-check" });
    if (!study.view().hasNotes) return mount(content, head, needNotes("Tests"));
    if (running) return mount(content, head, createTest({ ...running, onAgain: () => (round++, draw()), onExit: () => ((running = null), draw()) }));
    const count = segmented({ label: "Number of questions", value: 10, options: [[8, "8 questions"], [10, "10 questions"], [15, "15 questions"]] });
    const level = segmented({ label: "Difficulty", value: "standard", options: [["easier", "Easier"], ["standard", "Standard"], ["harder", "Harder"]] });
    mount(content, head, h("div", { class: "card stack-lg" }, h("div", { class: "row setup-row" }, field("Length", count), field("Level", level)), h("div", { class: "row" }, h("button", { class: "btn btn-primary btn-lg", type: "button", onclick: () => ((running = { count: count.value, difficulty: level.value }), round++, draw()) }, icon("play"), "Start test")), h("p", { class: "muted small" }, "Multiple choice and short answer, graded when you submit.")));
  }
  draw();
  return studyLayout(ctx, content);
}
