import { h, icon, skeleton, fmtDate, plural, pts, num } from "../dom.js";
import { api } from "../api.js";
import { classSession, study } from "../store.js";
import { navigate } from "../router.js";
import { toast } from "../toast.js";
import { confirmDialog } from "../ui.js";

export default async function ClassPage() {
  const session = classSession.get();
  if (!session) {
    navigate("/join", { replace: true });
    return h("div");
  }
  document.title = `${session.className} | StudyBuddy`;
  let data;
  try {
    data = await api.get("/api/student/class");
  } catch (e) {
    if (e.status === 404 || e.status === 401) {
      classSession.clear();
      toast(e.message, { error: true });
      navigate("/join", { replace: true });
      return h("div");
    }
    return h("div", { class: "card stack" }, h("p", { class: "form-error" }, e.message), h("button", { class: "btn btn-primary", onclick: () => navigate("/class", { replace: true }) }, "Try again"));
  }

  async function studyMaterial(m, btn) {
    btn.disabled = true;
    try {
      const doc = await api.get(`/api/student/materials/${m.id}`);
      const res = study.addNote({ title: doc.title, text: doc.content, source: "class" });
      if (!res.ok) throw new Error(res.reason);
      toast(`Added "${doc.title}" to your notes`);
      navigate("/quiz");
    } catch (e) {
      toast(e.message, { error: true });
      btn.disabled = false;
    }
  }

  return h(
    "div",
    { class: "stack-lg" },
    h("div", { class: "mode-header" }, h("span", { class: "mode-icon" }, icon("school", 26)), h("div", { class: "grow" }, h("h1", { class: "mode-title" }, data.className), h("p", { class: "mode-blurb" }, `Hi ${data.firstName}. Here's what your teacher has set up.`)), h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: async () => (await confirmDialog({ title: "Leave this class?", message: "You can rejoin any time with the class code. Your homework results stay with your teacher.", confirmLabel: "Leave class", danger: true })) && (classSession.clear(), navigate("/")) }, icon("log-out"), "Leave class")),

    h("section", { class: "stack" }, h("h2", { class: "section-title" }, "Homework"),
      data.homework.length === 0
        ? h("div", { class: "card muted" }, "No homework yet. When your teacher publishes some, it shows up here.")
        : data.homework.map((hw) => {
            const sub = hw.submission;
            const pct = sub && sub.maxScore > 0 ? Math.round((sub.score / sub.maxScore) * 100) : null;
            const late = hw.dueAt && new Date(hw.dueAt) < new Date() && !sub;
            return h("article", { class: "card hw-card" }, h("div", { class: "grow stack" }, h("div", { class: "row" }, h("h3", { class: "card-title" }, hw.title), sub ? h("span", { class: "chip chip-ok" }, icon("check", 14), `Done: ${num(sub.score)}/${num(sub.maxScore)} (${pct}%)`) : late ? h("span", { class: "chip chip-miss" }, "Past due") : h("span", { class: "chip" }, "To do")), hw.instructions && h("p", { class: "muted" }, hw.instructions), h("p", { class: "muted small" }, [plural(hw.questionCount, "question"), pts(hw.totalPoints), hw.dueAt && `Due ${fmtDate(hw.dueAt)}`].filter(Boolean).join(" · "))), h("a", { class: `btn ${sub ? "btn-outline" : "btn-primary"}`, href: `/class/homework/${hw.id}` }, sub ? "Review" : "Start", icon("arrow-right")));
          })
    ),

    h("section", { class: "stack" }, h("h2", { class: "section-title" }, "Class materials"), h("p", { class: "muted" }, "Add your teacher's material to your notes, then quiz yourself on it."),
      data.materials.length === 0
        ? h("div", { class: "card muted" }, "No materials yet.")
        : data.materials.map((m) => { const btn = h("button", { class: "btn btn-outline", type: "button", onclick: () => studyMaterial(m, btn) }, icon("book-open"), "Study this"); return h("article", { class: "card hw-card" }, h("div", { class: "grow" }, h("h3", { class: "card-title" }, m.title), h("p", { class: "muted small" }, `${m.chars.toLocaleString()} characters`)), btn); })
    )
  );
}
