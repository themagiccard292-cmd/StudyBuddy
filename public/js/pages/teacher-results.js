import { h, icon, fmtDateTime, plural, pts, num } from "../dom.js";
import { api } from "../api.js";
import { requireTeacher } from "./_auth.js";
import { richInline } from "../rich.js";

export default async function TeacherResults(ctx) {
  const user = await requireTeacher();
  if (!user) return h("div");
  let r;
  try {
    r = await api.get(`/api/teacher/homework/${ctx.params.hid}/results`);
  } catch (e) {
    return h("div", { class: "card stack" }, h("p", { class: "form-error" }, e.message), h("a", { class: "btn btn-primary", href: "/teacher" }, "Back"));
  }
  const a = r.assignment;
  document.title = `Results: ${a.title} | StudyBuddy`;
  const back = `/teacher/classes/${ctx.params.id}`;
  const rate = r.summary.total ? Math.round((r.summary.completed / r.summary.total) * 100) : 0;
  const hardest = [...r.questions].filter((q) => q.percentCorrect !== null).sort((x, y) => x.percentCorrect - y.percentCorrect);

  const tile = (big, label, tone) => h("div", { class: `stat-tile ${tone ?? ""}` }, h("b", null, big), h("span", null, label));

  return h(
    "div",
    { class: "stack-lg" },
    h("a", { class: "btn btn-ghost btn-sm back", href: back }, icon("arrow-left"), a.className),
    h("div", { class: "mode-header" }, h("span", { class: "mode-icon" }, icon("chart-column", 26)), h("div", { class: "grow" }, h("h1", { class: "mode-title" }, a.title), h("p", { class: "mode-blurb" }, `${plural(a.questionCount, "question")} · ${pts(a.totalPoints)}${a.dueAt ? ` · due ${fmtDateTime(a.dueAt)}` : ""}`)), h("a", { class: "btn btn-outline btn-sm", href: `${back}/homework/${a.id}` }, icon("pencil"), "Edit")),
    h("div", { class: "tiles" }, tile(`${r.summary.completed}/${r.summary.total}`, "students finished", "t1"), tile(`${rate}%`, "completion rate", "t2"), tile(r.summary.avgPercent === null ? "-" : `${r.summary.avgPercent}%`, "class average", "t3")),
    r.students.length === 0
      ? h("div", { class: "card center muted" }, "No students have joined this class yet.")
      : h("div", { class: "card table-card" }, h("table", { class: "table" }, h("thead", null, h("tr", null, h("th", null, "Student"), h("th", null, "Status"), h("th", { class: "num-col" }, "Score"), h("th", null, "Result"), h("th", { class: "num-col" }, "Tries"), h("th", null, "Handed in"))), h("tbody", null, r.students.map((s) => h("tr", null, h("td", null, h("b", null, s.firstName)), h("td", null, s.status === "completed" ? h("span", { class: "chip chip-ok" }, icon("check", 13), "Done") : h("span", { class: "chip chip-draft" }, "Not started")), h("td", { class: "num-col" }, s.status === "completed" ? `${num(s.score)}/${num(s.maxScore)}` : "-"), h("td", { class: "bar-col" }, s.percent === null ? h("span", { class: "muted" }, "-") : h("div", { class: "row nowrap" }, h("div", { class: "meter grow" }, h("div", { class: `meter-fill${s.percent >= 70 ? " ok" : ""}`, style: { width: `${s.percent}%` } })), h("span", { class: "pct" }, `${s.percent}%`))), h("td", { class: "num-col muted" }, s.attempts || "-"), h("td", { class: "muted" }, s.completedAt ? fmtDateTime(s.completedAt) : "-")))))),
    hardest.length > 0 && h("section", { class: "card stack" }, h("h2", { class: "card-title" }, "Question by question"), h("p", { class: "muted small" }, "Hardest first. This shows what the class might need to revisit."), h("ul", { class: "q-stats" }, hardest.map((q) => h("li", null, h("div", { class: "grow" }, richInline(q.question, "q-text"), h("p", { class: "muted small" }, `${q.topic} · ${plural(q.answered, "answer")}`)), h("div", { class: "row nowrap q-meter" }, h("div", { class: "meter grow" }, h("div", { class: `meter-fill${q.percentCorrect >= 70 ? " ok" : ""}`, style: { width: `${q.percentCorrect}%` } })), h("b", { class: "pct" }, `${q.percentCorrect}%`))))))
  );
}
