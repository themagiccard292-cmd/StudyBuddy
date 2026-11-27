import { h, icon, spinner } from "../dom.js";
import { api } from "../api.js";
import { auth, currentUser } from "../auth.js";
import { classSession } from "../store.js";
import { navigate } from "../router.js";
import { segmented, errorBox, field } from "../ui.js";

export default async function Login(ctx) {
  document.title = "Log in | StudyBuddy";
  const existing = await currentUser();
  if (existing) {
    navigate(existing.role === "teacher" ? "/teacher" : "/class", { replace: true });
    return h("div");
  }

  let role = ctx.query.get("role") === "teacher" ? "teacher" : "student";
  let mode = ctx.query.get("mode") === "register" ? "register" : "login";
  const card = h("div", { class: "card narrow stack-lg" });
  const err = errorBox();

  async function submit(values, btn) {
    err.clear();
    btn.disabled = true;
    btn.replaceChildren(spinner(), mode === "login" ? "Logging in…" : "Creating account…");
    try {
      const guest = classSession.get();
      const guestToken = guest?.token; // a class joined as a guest on this device comes along
      if (guest && !guestToken) classSession.clear(); // a class picked by an earlier account isn't this account's
      let res;
      if (role === "teacher") {
        res = await api.post(mode === "login" ? "/api/auth/login" : "/api/auth/register", mode === "login" ? { email: values.email, password: values.password } : { email: values.email, displayName: values.name, password: values.password });
      } else {
        res = await api.post(mode === "login" ? "/api/auth/student/login" : "/api/auth/student/register", mode === "login" ? { username: values.username, password: values.password, guestToken } : { username: values.username, firstName: values.name, password: values.password, guestToken });
        if (guestToken) {
          // The device token is retired either way: the account's login now speaks for this student.
          if (res.claimedClass) classSession.set({ classId: guest.classId, className: guest.className, firstName: guest.firstName });
          else classSession.clear();
        }
      }
      auth.set(res.user);
      navigate(role === "teacher" ? "/teacher" : "/class");
    } catch (e) {
      err.show(e.message);
      btn.disabled = false;
      btn.replaceChildren(mode === "login" ? "Log in" : "Create account");
    }
  }

  function draw() {
    const input = (id, props = {}) => h("input", { class: "input", id, ...props });
    const email = input("email", { type: "email", autocomplete: "email", placeholder: "you@school.org", required: true });
    const username = input("username", { autocomplete: "username", placeholder: "skater_12", maxlength: 24, spellcheck: "false", autocapitalize: "none" });
    const name = input("name", { autocomplete: "given-name", placeholder: role === "teacher" ? "Ms. Rivera" : "Your first name", maxlength: role === "teacher" ? 60 : 30 });
    const pass = input("pass", { type: "password", autocomplete: mode === "login" ? "current-password" : "new-password", required: true });
    const btn = h("button", { class: "btn btn-primary btn-lg", type: "submit" }, mode === "login" ? "Log in" : "Create account");
    err.clear();

    const fields = role === "teacher"
      ? [field("Email", email), mode === "register" && field("Your name", name, "How students see you, like Ms. Rivera."), field("Password", pass, mode === "register" ? "At least 8 characters." : undefined)]
      : [field("Username", username, mode === "register" ? "Pick something that isn't your full name, like skater_12. Letters, numbers, dots, dashes and underscores." : undefined), mode === "register" && field("First name", name, "Your teacher sees your first name only."), field("Password", pass, mode === "register" ? "At least 8 characters." : undefined)];

    const help = mode === "login"
      ? role === "student"
        ? "Forgot your password? Ask your teacher to reset it."
        : "Forgot your password? There's no email reset yet, so ask the person who runs this site to reset it."
      : role === "student"
        ? "An account keeps your classes and homework on any device. You can still join a class without one."
        : "";

    card.replaceChildren(
      h("div", { class: "stack" }, h("span", { class: "mode-icon" }, icon(role === "teacher" ? "graduation-cap" : "user-round", 26)), h("h1", { class: "page-title" }, mode === "login" ? "Log in" : "Create your account"), h("p", { class: "muted" }, role === "teacher" ? "Make classes, share curriculum with the AI, set homework and see who finished it." : "Keep your classes and homework in one place, on any device.")),
      segmented({ label: "I am a", value: role, options: [["student", "I'm a student"], ["teacher", "I'm a teacher"]], onChange: (v) => ((role = v), draw()) }),
      segmented({ label: "Log in or sign up", value: mode, options: [["login", "Log in"], ["register", "Create account"]], onChange: (v) => ((mode = v), draw()) }),
      h("form", { class: "stack", onsubmit: (e) => (e.preventDefault(), submit({ email: email.value, username: username.value.trim(), name: name.value.trim(), password: pass.value }, btn)) }, err, ...fields, btn),
      help && h("p", { class: "muted small" }, help),
      role === "student" && h("p", { class: "muted small" }, "Just have a class code? ", h("a", { href: "/join" }, "Join without an account"), ".")
    );
  }
  draw();
  return h("div", { class: "center-page" }, card);
}
