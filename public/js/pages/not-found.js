import { h, icon } from "../dom.js";

export default function NotFound() {
  return h("div", { class: "card center narrow stack" }, icon("circle-help", 32), h("h1", { class: "page-title" }, "That page doesn't exist"), h("p", { class: "muted" }, "Check the address, or head back home."), h("a", { class: "btn btn-primary", href: "/" }, "Back to home"));
}
