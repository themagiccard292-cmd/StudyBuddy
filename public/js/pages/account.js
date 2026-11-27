import { h, icon, spinner } from "../dom.js";
import { api } from "../api.js";
import { auth, currentUser } from "../auth.js";
import { navigate } from "../router.js";
import { toast } from "../toast.js";
import { errorBox, field } from "../ui.js";

export default async function Account() {
  document.title = "Your account | StudyBuddy";
  const user = await currentUser();
  if (!user) {
    navigate("/login", { replace: true });
    return h("div");
  }

  const current = h("input", { class: "input", id: "cur", type: "password", autocomplete: "current-password" });
  const next = h("input", { class: "input", id: "new", type: "password", autocomplete: "new-password" });
  const err = errorBox();
  const btn = h("button", { class: "btn btn-primary", type: "submit" }, "Change password");

  return h(
    "div",
    { class: "stack-lg narrow-wide" },
    h("div", { class: "mode-header" }, h("span", { class: "mode-icon" }, icon("user-round", 26)), h("div", { class: "grow" }, h("h1", { class: "mode-title" }, user.displayName), h("p", { class: "mode-blurb" }, user.role === "teacher" ? `Teacher account · ${user.email}` : `Student account · username ${user.username}`))),
    h("form", { class: "card stack", onsubmit: async (e) => {
      e.preventDefault();
      err.clear();
      btn.disabled = true;
      btn.replaceChildren(spinner(), "Saving…");
      try {
        await api.post("/api/auth/password", { current: current.value, next: next.value });
        current.value = next.value = "";
        toast("Password changed. Other devices were logged out.");
      } catch (e2) {
        err.show(e2.message);
      }
      btn.disabled = false;
      btn.replaceChildren("Change password");
    } },
      h("h2", { class: "card-title" }, "Change your password"), err, field("Current password", current), field("New password", next, "At least 8 characters."), h("div", null, btn)),
    h("div", { class: "row" },
      h("a", { class: "btn btn-outline", href: user.role === "teacher" ? "/teacher" : "/class" }, user.role === "teacher" ? "My classes" : "My classes and homework"),
      h("button", { class: "btn btn-ghost", type: "button", onclick: async () => (await auth.logout(), navigate("/")) }, icon("log-out"), "Log out")),
    user.role === "student" && h("p", { class: "muted small" }, "Your notes and study progress are saved on this device. Your classes and homework follow your account to any device.")
  );
}
