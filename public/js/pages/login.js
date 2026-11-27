import { h, icon, spinner } from "../dom.js";
import { api } from "../api.js";
import { navigate } from "../router.js";
import { segmented, errorBox, field } from "../ui.js";

export default async function Login() {
  document.title = "Teacher login | StudyBuddy";
  const { user } = await api.get("/api/auth/me");
  if (user) {
    window.__setTeacher?.(user);
    navigate("/teacher", { replace: true });
    return h("div");
  }

  let mode = "login";
  const card = h("div", { class: "card narrow stack-lg" });
  const err = errorBox();

  function draw() {
    const email = h("input", { class: "input", type: "email", id: "email", autocomplete: "email", placeholder: "you@school.org", required: true });
    const name = h("input", { class: "input", id: "name", autocomplete: "name", placeholder: "Ms. Rivera", maxlength: 60 });
    const pass = h("input", { class: "input", type: "password", id: "pass", autocomplete: mode === "login" ? "current-password" : "new-password", required: true });
    const btn = h("button", { class: "btn btn-primary btn-lg", type: "submit" }, mode === "login" ? "Log in" : "Create account");
    err.clear();
    card.replaceChildren(
      h("div", { class: "stack" }, h("span", { class: "mode-icon" }, icon("graduation-cap", 26)), h("h1", { class: "page-title" }, "For teachers"), h("p", { class: "muted" }, "Make classes, share curriculum with the AI, set homework and see who finished it. Students never need an account.")),
      segmented({ label: "Log in or sign up", value: mode, options: [["login", "Log in"], ["register", "Create account"]], onChange: (v) => ((mode = v), draw()) }),
      h("form", { class: "stack", onsubmit: async (e) => {
        e.preventDefault();
        err.clear();
        btn.disabled = true;
        btn.replaceChildren(spinner(), mode === "login" ? "Logging in…" : "Creating account…");
        try {
          const res = await api.post(mode === "login" ? "/api/auth/login" : "/api/auth/register", mode === "login" ? { email: email.value, password: pass.value } : { email: email.value, displayName: name.value, password: pass.value });
          window.__setTeacher?.(res.user);
          navigate("/teacher");
        } catch (e2) {
          err.show(e2.message);
          btn.disabled = false;
          btn.replaceChildren(mode === "login" ? "Log in" : "Create account");
        }
      } }, err, field("Email", email), mode === "register" && field("Your name", name, "How students see you, like Ms. Rivera."), field("Password", pass, mode === "register" ? "At least 8 characters." : undefined), btn)
    );
  }
  draw();
  return h("div", { class: "center-page" }, card);
}
