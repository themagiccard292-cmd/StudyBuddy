import { h } from "./dom.js";

export function toast(message, { error = false, ms = 3500 } = {}) {
  const el = h("div", { class: `toast${error ? " error" : ""}`, role: error ? "alert" : "status" }, message);
  document.getElementById("toasts").append(el);
  setTimeout(() => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 300);
  }, ms);
}
