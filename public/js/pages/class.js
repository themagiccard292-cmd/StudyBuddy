import { h, icon, fmtDate, plural, pts, num } from "../dom.js";
import { api } from "../api.js";
import { currentUser } from "../auth.js";
import { classSession, study } from "../store.js";
import { navigate } from "../router.js";
import { toast } from "../toast.js";
import { confirmDialog } from "../ui.js";

const failCard = (e) =>
  h("div", { class: "card stack" }, h("p", { class: "form-error" }, e.message), h("button", { class: "btn btn-primary", onclick: () => navigate("/class", { replace: true }) }, "Try again"));

export default async function ClassPage(ctx) {
  const user = await currentUser();
  if (user?.role === "student") return accountClassPage(ctx);
  if (user?.role === "teacher") {
    navigate("/teacher", { replace: true });
    return h("div");
  }
  if (!classSession.get()?.token) {
    navigate("/join", { replace: true });
    return h("div");
  }
  return classHome({ canSwitch: false, guest: true });
}

// A logged-in student can be in several classes: pick one, then see its homework.
async function accountClassPage(ctx) {
  let list;
  try {
    list = (await api.get("/api/student/classes")).classes;
  } catch (e) {
    return failCard(e);
  }
  if (!list.length) {
    classSession.clear();
    navigate("/join", { replace: true });
    return h("div");
  }
  const session = classSession.get();
  const chosen = session && list.find((c) => c.classId === session.classId);
  const wantsSwitch = ctx.query.get("switch") === "1";
  if (!wantsSwitch && (chosen || list.length === 1)) {
    const c = chosen ?? list[0];
    classSession.set({ classId: c.classId, className: c.className, firstName: c.firstName });
    return classHome({ canSwitch: list.length > 1, guest: false });
  }

  document.title = "My classes | StudyBuddy";
  return h(
    "div",
    { class: "stack-lg" },
    h("div", { class: "mode-header" }, h("span", { class: "mode-icon" }, icon("school", 26)), h("div", { class: "grow" }, h("h1", { class: "mode-title" }, "My classes"), h("p", { class: "mode-blurb" }, "Pick a class to see its homework and materials.")), h("a", { class: "btn btn-outline", href: "/join" }, icon("plus"), "Join another class")),
    h("div", { class: "class-grid" }, list.map((c) =>
      h("button", { class: "card class-card class-pick", type: "button", onclick: () => (classSession.set({ classId: c.classId, className: c.className, firstName: c.firstName }), navigate("/class")) },
        h("h2", { class: "card-title" }, c.className),
        h("p", { class: "muted small" }, c.toDo ? `${c.toDo} to do` : "All caught up"),
        c.toDo > 0 && h("span", { class: "chip chip-mark" }, plural(c.toDo, "homework", "homework"))
      )
    ))
  );
}

async function classHome({ canSwitch, guest }) {
  const session = classSession.get();
  document.title = `${session.className} | StudyBuddy`;
  let data;
  try {
    data = await api.get("/api/student/class");
  } catch (e) {
    if (e.status === 404 || e.status === 401 || e.status === 400) {
      if (guest) classSession.clear();
      else classSession.clear();
      toast(e.message, { error: true });
      navigate(guest ? "/join" : "/class", { replace: true });
      return h("div");
    }
    return failCard(e);
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
    h("div", { class: "mode-header" }, h("span", { class: "mode-icon" }, icon("school", 26)), h("div", { class: "grow" }, h("h1", { class: "mode-title" }, data.className), h("p", { class: "mode-blurb" }, `Hi ${data.firstName}. Here's what your teacher has set up.`)),
      guest
        ? h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: async () => (await confirmDialog({ title: "Leave this class?", message: "You can rejoin any time with the class code. Your homework results stay with your teacher.", confirmLabel: "Leave class", danger: true })) && (classSession.clear(), navigate("/")) }, icon("log-out"), "Leave class")
        : h("div", { class: "row" }, canSwitch && h("a", { class: "btn btn-outline btn-sm", href: "/class?switch=1" }, "All my classes"), h("a", { class: "btn btn-ghost btn-sm", href: "/join" }, icon("plus"), "Join another class"))),

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
