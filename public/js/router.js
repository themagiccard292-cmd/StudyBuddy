// A very small client-side router (History API).
const routes = [];
let outlet;
let cleanups = [];
let onChange = () => {};
let token = 0;

export function route(pattern, handler, meta = {}) {
  const keys = [];
  const re = new RegExp(
    "^" + pattern.replace(/:([a-zA-Z]+)/g, (_, k) => (keys.push(k), "([^/]+)")) + "/?$"
  );
  routes.push({ re, keys, handler, meta, pattern });
}

export function navigate(path, { replace = false } = {}) {
  if (path === location.pathname + location.search) return render();
  history[replace ? "replaceState" : "pushState"]({}, "", path);
  render();
}

export const currentMeta = () => matchRoute(location.pathname)?.meta ?? {};

function matchRoute(pathname) {
  for (const r of routes) {
    const m = r.re.exec(pathname);
    if (m) return { ...r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

async function render() {
  const my = ++token;
  cleanups.forEach((fn) => fn());
  cleanups = [];
  const match = matchRoute(location.pathname) ?? matchRoute("/404");
  onChange(match?.meta ?? {});
  const ctx = {
    params: match.params,
    query: new URLSearchParams(location.search),
    navigate,
    cleanup: (fn) => cleanups.push(fn),
  };
  let node;
  try {
    node = await match.handler(ctx);
  } catch (e) {
    console.error(e);
    const p = document.createElement("p");
    p.className = "card";
    p.textContent = "Something went wrong loading this page. Try refreshing.";
    node = p;
  }
  if (my !== token) return; // a newer navigation won
  outlet.replaceChildren(node);
  window.scrollTo({ top: 0 });
  outlet.focus({ preventScroll: true });
}

export function startRouter(el, changed) {
  outlet = el;
  onChange = changed;
  window.addEventListener("popstate", render);
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest?.("a[href]");
    if (!a || a.target || a.hasAttribute("download")) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return;
    e.preventDefault();
    navigate(url.pathname + url.search);
  });
  render();
}
