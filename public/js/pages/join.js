import { h, icon, spinner } from "../dom.js";
import { api } from "../api.js";
import { classSession } from "../store.js";
import { navigate } from "../router.js";
import { errorBox, field } from "../ui.js";

export default function Join(ctx) {
  document.title = "Join your class | StudyBuddy";
  if (classSession.get()) {
    navigate("/class", { replace: true });
    return h("div");
  }
  const code = h("input", { class: "input input-code", maxlength: 6, autocomplete: "off", spellcheck: "false", id: "code", placeholder: "ABC123", value: (ctx.query.get("code") ?? "").toUpperCase().slice(0, 6) });
  const name = h("input", { class: "input", maxlength: 30, autocomplete: "given-name", id: "first-name", placeholder: "Your first name" });
  const err = errorBox();
  const btn = h("button", { class: "btn btn-primary btn-lg", type: "submit" }, "Join class", icon("arrow-right"));

  const form = h("form", { class: "card narrow stack-lg", onsubmit: async (e) => {
    e.preventDefault();
    err.clear();
    btn.disabled = true;
    btn.replaceChildren(spinner(), "Joining…");
    try {
      const res = await api.post("/api/student/join", { code: code.value.trim(), firstName: name.value.trim() });
      classSession.set({ token: res.token, classId: res.classId, className: res.className, firstName: res.firstName });
      navigate("/class");
    } catch (e2) {
      err.show(e2.message);
      btn.disabled = false;
      btn.replaceChildren("Join class", icon("arrow-right"));
    }
  } },
    h("div", { class: "stack" }, h("span", { class: "mode-icon" }, icon("school", 26)), h("h1", { class: "page-title" }, "Join your class"), h("p", { class: "muted" }, "Enter the 6-letter code from your teacher and your first name. That's all StudyBuddy asks for: no email, no password.")),
    err,
    field("Class code", code),
    field("Your first name", name, "Just your first name, so your teacher knows who you are."),
    btn
  );
  queueMicrotask(() => (code.value ? name : code).focus());
  return h("div", { class: "center-page" }, form);
}
