import { ICONS } from "./icons.js";

/** Tiny hyperscript: h("div", { class: "x", onclick }, child, ...). */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "value") el.value = v;
    else if (["checked", "disabled", "selected", "hidden", "open"].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  add(el, children);
  return el;
}

function add(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
}

/** Replace everything inside `parent`. */
export function mount(parent, ...children) {
  parent.replaceChildren();
  add(parent, children);
  return parent;
}

export function icon(name, size = 18) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  el.setAttribute("class", "icon");
  el.setAttribute("width", size);
  el.setAttribute("height", size);
  el.setAttribute("viewBox", "0 0 24 24");
  el.setAttribute("fill", "none");
  el.setAttribute("stroke", "currentColor");
  el.setAttribute("stroke-width", "2");
  el.setAttribute("stroke-linecap", "round");
  el.setAttribute("stroke-linejoin", "round");
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = ICONS[name] ?? ""; // static, trusted icon markup
  return el;
}

export const spinner = () => h("span", { class: "spinner", role: "status", "aria-label": "Loading" });
export const skeleton = (height = "1.5rem", width = "100%") => h("div", { class: "skeleton", style: { height, width } });

export function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso.includes("T") || iso.includes("Z") ? iso : iso.replace(" ", "T") + "Z");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
export function fmtDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso.includes("T") || iso.includes("Z") ? iso : iso.replace(" ", "T") + "Z");
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
export const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
export const num = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
export const pts = (n) => `${num(n)} ${n === 1 ? "point" : "points"}`;
