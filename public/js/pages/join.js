import { h, icon, spinner } from "../dom.js";
import { api } from "../api.js";
import { currentUser } from "../auth.js";
import { classSession } from "../store.js";
import { navigate } from "../router.js";
import { toast } from "../toast.js";
import { errorBox, field } from "../ui.js";

export default async function Join(ctx) {
  document.title = "Join your class | StudyBuddy";
  const user = await currentUser();
  const isStudentAccount = user?.role === "student";
  if (!isStudentAccount && classSession.get()?.token) {
    navigate("/class", { replace: true });
    return h("div");
  }

  if (user?.role === "teacher") {
    return h("div", { class: "center-page" }, h("div", { class: "card narrow stack" }, h("span", { class: "mode-icon" }, icon("school", 26)), h("h1", { class: "page-title" }, "You're logged in as a teacher"), h("p", { class: "muted" }, "Students join with a class code. To try it as a student, log out first."), h("a", { class: "btn btn-primary", href: "/teacher" }, "Back to my classes")));
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
      const res = await api.post("/api/student/join", { code: code.value.trim(), firstName: isStudentAccount ? undefined : name.value.trim() });
      // A guest keeps a private token on this device; an account just remembers which class is open.
      classSession.set({ token: res.token, classId: res.classId, className: res.className, firstName: res.firstName });
      if (res.alreadyJoined) toast("You're already in that class.");
      navigate("/class");
    } catch (e2) {
      err.show(e2.message);
      btn.disabled = false;
      btn.replaceChildren("Join class", icon("arrow-right"));
    }
  } },
    h("div", { class: "stack" }, h("span", { class: "mode-icon" }, icon("school", 26)), h("h1", { class: "page-title" }, "Join your class"), h("p", { class: "muted" }, isStudentAccount ? `Enter the 6-letter code from your teacher. It's added to your account, ${user.displayName}.` : "Enter the 6-letter code from your teacher and your first name. No email, no password needed.")),
    err,
    field("Class code", code),
    !isStudentAccount && field("Your first name", name, "Just your first name, so your teacher knows who you are."),
    btn,
    !isStudentAccount && h("p", { class: "muted small" }, "Want your classes on every device? ", h("a", { href: "/login?mode=register" }, "Create a student account"), " or ", h("a", { href: "/login" }, "log in"), ".")
  );
  queueMicrotask(() => (code.value ? name : code).focus());
  return h("div", { class: "center-page" }, form);
}
