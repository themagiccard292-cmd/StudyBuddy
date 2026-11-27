import { h, icon, plural } from "../dom.js";
import { api } from "../api.js";
import { navigate } from "../router.js";
import { dialog, errorBox, field } from "../ui.js";
import { requireTeacher } from "./_auth.js";

export default async function TeacherHome() {
  const user = await requireTeacher();
  if (!user) return h("div");
  document.title = "Your classes | StudyBuddy";
  const { classes } = await api.get("/api/teacher/classes");

  function newClass() {
    const name = h("input", { class: "input", placeholder: "Period 3 Biology", maxlength: 80, id: "cn" });
    const subject = h("input", { class: "input", placeholder: "Optional", maxlength: 60, id: "cs" });
    const err = errorBox();
    dialog({
      title: "New class",
      body: h("form", { class: "stack", id: "new-class-form" }, err, field("Class name", name), field("Subject", subject, "Anything you like: it just helps you tell classes apart.")),
      actions: (close) => [
        h("button", { class: "btn btn-ghost", type: "button", onclick: () => close("cancel") }, "Cancel"),
        h("button", { class: "btn btn-primary", type: "button", onclick: async (e) => {
          err.clear();
          e.target.disabled = true;
          try {
            const res = await api.post("/api/teacher/classes", { name: name.value, subject: subject.value });
            close("ok");
            navigate(`/teacher/classes/${res.id}`);
          } catch (e2) {
            err.show(e2.message);
            e.target.disabled = false;
          }
        } }, "Create class"),
      ],
    });
    queueMicrotask(() => name.focus());
  }

  return h(
    "div",
    { class: "stack-lg" },
    h("div", { class: "mode-header" }, h("span", { class: "mode-icon" }, icon("users", 26)), h("div", { class: "grow" }, h("h1", { class: "mode-title" }, "Your classes"), h("p", { class: "mode-blurb" }, "Each class has a join code. Students join with the code and their first name: no accounts.")), h("button", { class: "btn btn-primary", type: "button", onclick: newClass }, icon("plus"), "New class")),
    classes.length === 0
      ? h("div", { class: "card center stack empty" }, icon("school", 32), h("h2", { class: "card-title" }, "Make your first class"), h("p", { class: "muted" }, "Then upload your curriculum, chat with the AI to build homework, and watch the results come in."), h("div", null, h("button", { class: "btn btn-primary btn-lg", type: "button", onclick: newClass }, icon("plus"), "Create a class")))
      : h("div", { class: "class-grid" }, classes.map((c) => h("a", { class: "card class-card", href: `/teacher/classes/${c.id}` }, h("div", { class: "row row-between" }, h("h2", { class: "card-title" }, c.name), c.subject && h("span", { class: "chip" }, c.subject)), h("div", { class: "code-pill" }, h("span", { class: "muted small" }, "Join code"), h("b", null, c.joinCode)), h("p", { class: "muted small" }, `${plural(c.studentCount, "student")} · ${plural(c.homeworkCount, "homework", "homework")}`))))
  );
}
