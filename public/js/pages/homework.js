import { h, mount, icon, spinner, fmtDateTime, num, pts } from "../dom.js";
import { rich, richInline } from "../rich.js";
import { api } from "../api.js";
import { classSession } from "../store.js";
import { navigate } from "../router.js";
import { errorBox } from "../ui.js";

const LETTERS = ["A", "B", "C", "D"];

export default async function Homework(ctx) {
  if (!classSession.get()) {
    navigate("/join", { replace: true });
    return h("div");
  }
  const id = ctx.params.id;
  let data;
  try {
    data = await api.get(`/api/student/homework/${id}`);
  } catch (e) {
    return h("div", { class: "card stack" }, h("p", { class: "form-error" }, e.message), h("a", { class: "btn btn-primary", href: "/class" }, "Back to my class"));
  }
  document.title = `${data.assignment.title} | StudyBuddy`;

  const draftKey = `studybuddy:hw:${id}`;
  const loadDraft = () => { try { return JSON.parse(localStorage.getItem(draftKey) ?? "{}"); } catch { return {}; } };
  const saveDraft = () => { try { localStorage.setItem(draftKey, JSON.stringify(answers)); } catch { /* ignore */ } };
  let answers = loadDraft(); // { [questionId]: string } so a reload never loses work
  let result = data.submission ? { score: data.submission.score, maxScore: data.submission.maxScore, results: data.submission.results, answers: Object.fromEntries(data.submission.answers.map((a) => [a.id, a.answer])), completedAt: data.submission.completedAt, attempts: data.submission.attempts } : null;
  let retaking = false;
  let busy = false;
  const root = h("div", { class: "stack-lg" });

  async function submit() {
    busy = true;
    err.clear();
    draw();
    try {
      const res = await api.post(`/api/student/homework/${id}/submit`, { answers: data.questions.map((q) => ({ id: q.id, answer: answers[q.id] ?? "" })) });
      result = { ...res, answers: { ...answers }, completedAt: new Date().toISOString(), attempts: (result?.attempts ?? 0) + 1 };
      retaking = false;
      try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
      busy = false;
      draw();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      busy = false;
      draw();
      err.show(e.message);
    }
  }
  const err = errorBox();

  function head(sub) {
    return h("div", { class: "stack" }, h("a", { class: "btn btn-ghost btn-sm back", href: "/class" }, icon("arrow-left"), "My class"), h("h1", { class: "page-title" }, data.assignment.title), data.assignment.instructions && h("p", { class: "muted" }, data.assignment.instructions), sub);
  }

  function refreshProgress() {
    const n = data.questions.filter((q) => (answers[q.id] ?? "").trim() !== "").length;
    const el = document.getElementById("hw-progress");
    if (el) el.textContent = `${n} of ${data.questions.length} answered`;
  }

  /** Select a choice without redrawing the whole page (keeps scroll position and typed answers). */
  function pick(btn, q, ci) {
    answers[q.id] = String(ci);
    saveDraft();
    [...btn.parentElement.children].forEach((b, i) => {
      b.classList.toggle("sel", i === ci);
      b.setAttribute("aria-checked", String(i === ci));
    });
    refreshProgress();
  }

  function draw() {
    if (result && !retaking) {
      const pct = result.maxScore > 0 ? Math.round((result.score / result.maxScore) * 100) : 0;
      return mount(
        root,
        head(),
        h("div", { class: "card stack" }, h("div", { class: "row summary-top" }, h("div", { class: "score" }, h("b", null, `${pct}%`), h("span", { class: "muted" }, `${num(result.score)} of ${num(result.maxScore)} points`)), h("p", { class: "summary-note" }, pct >= 85 ? "Great work. Your teacher can see this result." : pct >= 60 ? "Solid. Read the feedback below, then you can try again." : "Good effort. Read the feedback below, then try again.")), h("p", { class: "muted small" }, `Handed in ${fmtDateTime(result.completedAt)}${result.attempts > 1 ? ` · attempt ${result.attempts}` : ""}`), h("div", { class: "row" }, h("button", { class: "btn btn-outline", type: "button", onclick: () => ((retaking = true), (answers = {}), draw(), window.scrollTo({ top: 0 })) }, icon("rotate-ccw"), "Try again"), h("a", { class: "btn btn-ghost", href: "/class" }, "Back to my class"))),
        data.questions.map((q, i) => {
          const r = result.results.find((x) => x.id === q.id);
          const mine = result.answers[q.id] ?? "";
          const yours = q.type === "mc" ? (mine !== "" ? q.choices[Number(mine)] : "") : mine;
          return h("article", { class: `card review ${r?.verdict}` }, h("div", { class: "row" }, h("span", { class: "num" }, i + 1), h("span", { class: `chip ${r?.verdict === "correct" ? "chip-ok" : r?.verdict === "partial" ? "chip-mark" : "chip-miss"}` }, r?.verdict === "correct" ? "Right" : r?.verdict === "partial" ? "Partly right" : "Missed"), h("span", { class: "muted small" }, `${num(r?.earned ?? 0)}/${num(q.points)} pts`)), h("div", { class: "question q-sm" }, rich(q.question)), h("p", null, h("b", null, "Your answer: "), yours ? richInline(yours) : h("i", null, "No answer")), r?.verdict !== "correct" && h("p", null, h("b", null, "Correct answer: "), richInline(r?.correctAnswer ?? "")), r?.feedback && h("div", { class: "why" }, rich(r.feedback)));
        })
      );
    }

    const done = data.questions.filter((q) => (answers[q.id] ?? "").trim() !== "").length;
    mount(
      root,
      head(h("p", { class: "muted small" }, `${data.questions.length} questions · ${pts(data.questions.reduce((n, q) => n + q.points, 0))}${data.assignment.dueAt ? ` · due ${fmtDateTime(data.assignment.dueAt)}` : ""}. Your answers save as you go.`)),
      data.questions.map((q, i) =>
        h("article", { class: "card" }, h("div", { class: "row" }, h("span", { class: "num" }, i + 1), h("span", { class: "chip topic-chip" }, q.topic), h("span", { class: "muted small" }, `${num(q.points)} ${q.points === 1 ? "pt" : "pts"}`)), h("div", { class: "question q-sm" }, rich(q.question)),
          q.type === "mc"
            ? h("div", { class: "choices", role: "radiogroup", "aria-label": `Question ${i + 1} choices` }, q.choices.map((c, ci) => h("button", { type: "button", role: "radio", "aria-checked": answers[q.id] === String(ci), class: `choice${answers[q.id] === String(ci) ? " sel" : ""}`, onclick: (e) => pick(e.currentTarget, q, ci) }, h("span", { class: "letter" }, LETTERS[ci]), richInline(c))))
            : h("textarea", { class: "textarea", rows: 3, placeholder: "Your answer…", "aria-label": `Answer to question ${i + 1}`, value: answers[q.id] ?? "", oninput: (e) => ((answers[q.id] = e.target.value), saveDraft(), refreshProgress()) }))
      ),
      err,
      h("div", { class: "row" }, h("button", { class: "btn btn-primary btn-lg", type: "button", disabled: busy, onclick: submit }, busy ? [spinner(), "Grading…"] : [icon("send-horizontal"), "Hand in homework"]), h("span", { class: "muted small", id: "hw-progress" }, `${done} of ${data.questions.length} answered`))
    );
  }
  draw();
  return root;
}
