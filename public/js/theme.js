// Light / dark / auto. Dark is the default. The choice is remembered in this browser.
const KEY = "studybuddy:theme";
const listeners = new Set();
let media = null;

export const getMode = () => {
  try {
    return localStorage.getItem(KEY) || "dark";
  } catch {
    return "dark";
  }
};

function apply(mode) {
  media?.removeEventListener?.("change", onSystem);
  media = null;
  let theme = mode;
  if (mode === "auto") {
    media = window.matchMedia("(prefers-color-scheme: light)");
    media.addEventListener("change", onSystem);
    theme = media.matches ? "light" : "dark";
  }
  document.documentElement.setAttribute("data-theme", theme === "light" ? "light" : "dark");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#f4f8fd" : "#0b1020");
}
function onSystem() {
  if (getMode() === "auto") apply("auto");
}

export function setMode(mode) {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* private mode: just won't persist */
  }
  apply(mode);
  listeners.forEach((l) => l(mode));
}
export const onThemeChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));
export const initTheme = () => apply(getMode());
