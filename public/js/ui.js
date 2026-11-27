import { h, mount, icon, spinner, plural } from "./dom.js";
import { study, subscribe, classSession, NOTES_AI_CHARS } from "./store.js";
import { extractFileText } from "./pdf.js";
import { toast } from "./toast.js";
import { getMode, setMode, onThemeChange } from "./theme.js";
import { navigate } from "./router.js";
import { auth } from "./auth.js";

// ---------- theme switch (light / dark / auto) ----------
export function themeSwitch() {
  const opts = [
    ["dark", "moon", "Dark"],
    ["light", "sun", "Light"],
    ["auto", "monitor", "Match my device"],
  ];
  const wrap = h("div", { class: "theme-switch", role: "radiogroup", "aria-label": "Colour theme" });
  const draw = () =>
    mount(
      wrap,
      opts.map(([mode, ic, label]) =>
        h("button", { type: "button", role: "radio", "aria-checked": getMode() === mode, "aria-label": label, title: label, onclick: () => setMode(mode) }, icon(ic, 16))
      )
    );
  draw();
  onThemeChange(draw);
  return wrap;
}

// ---------- header ----------
const NAV = [
  ["/", "Home", true],
  ["/quiz", "Quiz"],
  ["/explain", "Explain it back"],
  ["/cards", "Flashcards"],
  ["/practice", "Practice"],
  ["/test", "Test"],
  ["/chat", "Chat"],
];

export function createHeader() {
  const el = h("header", { class: "header" });
  let meta = {};

  function draw() {
    const v = study.view();
    const session = classSession.get();
    const user = auth.get(); // undefined while we find out, null when logged out
    const inTeacher = meta.area === "teacher";
    const isTeacher = user?.role === "teacher";
    const isStudent = user?.role === "student";
    const here = location.pathname;

    const account = user
      ? [
          h("a", { class: "who-link", href: "/account", title: "Your account" }, icon("user-round", 15), h("span", { class: "who-name" }, user.displayName)),
          h("button", { class: "btn btn-ghost btn-sm logout-btn", type: "button", onclick: onLogout, "aria-label": "Log out" }, icon("log-out"), h("span", { class: "hide-sm" }, "Log out")),
        ]
      : user === null
        ? [h("a", { class: "btn btn-outline btn-sm", href: "/login" }, icon("log-in"), h("span", null, "Log in"))]
        : [];
    const joinLabel = isStudent ? "My classes" : session ? "My class" : "Join class";

    mount(
      el,
      h(
        "div",
        { class: "header-bar" },
        h("a", { class: "brand", href: isTeacher ? "/teacher" : "/", "aria-label": "StudyBuddy home" }, logo(), h("span", { class: "brand-text" }, "Study", h("span", { class: "mark" }, "Buddy"))),
        h(
          "div",
          { class: "header-actions" },
          inTeacher
            ? account
            : [
                !isTeacher && h("a", { class: "btn btn-primary btn-sm btn-pill", href: isStudent || session ? "/class" : "/join", "aria-label": joinLabel }, icon("school"), h("span", { class: "join-text" }, joinLabel)),
                h("span", { class: `chip-stat streak-chip${v.currentStreak > 0 ? " hot" : ""}`, title: v.currentStreak ? `${v.currentStreak}-day streak. ${v.masteredTopics.length} topics mastered.` : "Answer one question today to start a streak." }, icon("flame", 15), h("b", null, v.currentStreak), h("span", { class: "hide-sm" }, "day streak")),
                isTeacher && h("a", { class: "btn btn-ghost btn-sm", href: "/teacher" }, icon("graduation-cap"), h("span", { class: "hide-sm" }, "My classes")),
                account,
              ],
          themeSwitch()
        )
      ),
      meta.nav &&
        !inTeacher &&
        h(
          "nav",
          { class: "nav", "aria-label": "Study modes" },
          NAV.map(([href, label, end]) =>
            h("a", { href, class: `nav-link${(end ? here === href : here.startsWith(href)) ? " active" : ""}`, "aria-current": (end ? here === href : here.startsWith(href)) ? "page" : null }, label)
          )
        )
    );
  }

  async function onLogout() {
    await auth.logout();
    navigate("/");
  }

  subscribe(draw);
  classSession.subscribe(draw);
  auth.subscribe(draw);
  return {
    el,
    update(newMeta) {
      meta = newMeta;
      draw();
    },
  };
}

function logo() {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "logo");
  svg.setAttribute("viewBox", "0 0 32 32");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML =
    '<rect x="3" y="4" width="22" height="24" rx="5" class="logo-page"/><path d="M9 12h10M9 17h7" class="logo-lines"/><path d="M20 25l8-12 3 2-8 12-4 1z" class="logo-pen"/>';
  return svg;
}

// ---------- small building blocks ----------
export function modeHeader({ title, blurb, ic, actions }) {
  return h(
    "div",
    { class: "mode-header" },
    ic && h("span", { class: "mode-icon" }, icon(ic, 26)),
    h("div", { class: "grow" }, h("h1", { class: "mode-title" }, title), blurb && h("p", { class: "mode-blurb" }, blurb)),
    actions
  );
}

export function segmented({ label, value, options, onChange }) {
  let current = value;
  const el = h("div", { class: "seg", role: "radiogroup", "aria-label": label });
  const draw = () =>
    mount(
      el,
      options.map(([v, text]) =>
        h("button", { type: "button", role: "radio", "aria-checked": v === current, onclick: () => ((current = v), draw(), onChange?.(v)) }, text)
      )
    );
  draw();
  Object.defineProperty(el, "value", { get: () => current });
  return el;
}

export function field(label, control, hint) {
  // A real <label for> gives the control its accessible name (password boxes have no placeholder to fall back on).
  return h("div", { class: "field" }, h("label", { class: "label", for: control?.id || null }, label), control, hint && h("span", { class: "hint" }, hint));
}

export function dialog({ title, body, actions, onClose }) {
  const dlg = h("dialog", { class: "dlg", "aria-label": title });
  const close = (value) => {
    dlg.close(value);
  };
  mount(dlg, h("div", { class: "dlg-body" }, h("h2", { class: "dlg-title" }, title), body, h("div", { class: "dlg-actions" }, actions(close))));
  dlg.addEventListener("close", () => {
    onClose?.(dlg.returnValue);
    dlg.remove();
  });
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) dlg.close("cancel"); // click on the backdrop
  });
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

export function confirmDialog({ title, message, confirmLabel = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    dialog({
      title,
      body: h("p", { class: "muted" }, message),
      actions: (close) => [
        h("button", { class: "btn btn-ghost", type: "button", onclick: () => close("cancel") }, "Cancel"),
        h("button", { class: `btn ${danger ? "btn-danger" : "btn-primary"}`, type: "button", onclick: () => close("yes") }, confirmLabel),
      ],
      onClose: (v) => resolve(v === "yes"),
    });
  });
}

/** Inline error box that shows/clears a message. */
export function errorBox() {
  const el = h("div", { class: "form-error", role: "alert", hidden: true });
  el.show = (msg) => ((el.textContent = msg), (el.hidden = false));
  el.clear = () => (el.hidden = true);
  return el;
}

// ---------- notes ----------
export function notesInput({ variant = "compact", onAdded, textareaRef } = {}) {
  const text = h("textarea", {
    class: "notes-textarea",
    rows: variant === "hero" ? 7 : 5,
    placeholder: variant === "hero" ? "Paste your notes here: a chapter, class slides, a study guide…" : "Paste more notes…",
    "aria-label": "Paste your notes",
  });
  const title = h("input", { class: "input", placeholder: "Name (optional)", maxlength: 80, "aria-label": "Name for these notes" });
  const save = h("button", { class: `btn btn-primary${variant === "hero" ? " btn-lg" : ""}`, type: "button", disabled: true }, icon("plus"), "Save notes");
  const uploadHost = h("div", { class: "upload" });
  if (textareaRef) textareaRef.current = text;

  text.addEventListener("input", () => (save.disabled = text.value.trim().length < 20));
  save.addEventListener("click", () => {
    const res = study.addNote({ title: title.value, text: text.value, source: "paste" });
    if (!res.ok) return toast(res.reason, { error: true });
    text.value = title.value = "";
    save.disabled = true;
    toast("Notes saved");
    onAdded?.();
  });

  async function onFiles(files) {
    mount(uploadHost, h("div", { class: "upload-reading" }, spinner(), "Reading your file…"));
    try {
      for (const file of files) {
        if (file.size > 25 * 1024 * 1024) throw new Error("That file is over 25 MB.");
        const content = await extractFileText(file);
        const res = study.addNote({ title: file.name.replace(/\.[^.]+$/, ""), text: content, source: "file" });
        if (!res.ok) throw new Error(res.reason);
        toast(`Added ${file.name}`);
        onAdded?.();
      }
    } catch (e) {
      toast(e.message || "Couldn't read that file.", { error: true });
    } finally {
      drawUpload();
    }
  }
  function drawUpload() {
    const input = h("input", { type: "file", accept: ".pdf,.txt,.md,application/pdf,text/plain", multiple: true, "aria-label": "Upload a PDF or text file", onchange: (e) => (onFiles([...e.target.files]), (e.target.value = "")) });
    const zone = h("label", { class: "dropzone" }, input, icon("file-text", 22), h("span", { class: "dropzone-title" }, "Or upload a PDF or text file"), h("span", { class: "dropzone-sub" }, "Files are read in your browser, they aren't uploaded"));
    zone.addEventListener("dragover", (e) => (e.preventDefault(), zone.classList.add("drag")));
    zone.addEventListener("dragleave", () => zone.classList.remove("drag"));
    zone.addEventListener("drop", (e) => (e.preventDefault(), zone.classList.remove("drag"), onFiles([...e.dataTransfer.files])));
    mount(uploadHost, zone);
  }
  drawUpload();

  return h("div", { class: `notes-input${variant === "hero" ? " notes-hero" : ""}` }, h("div", { class: "paper" }, text, h("div", { class: "row nowrap" }, h("div", { class: "grow" }, title), save)), uploadHost);
}

export function notesPanel() {
  const el = h("div", { class: "notes-panel" });
  let openId = null;
  let adding = false;
  const draw = () => {
    const v = study.view();
    mount(
      el,
      h("div", { class: "notes-head" }, icon("book-open", 18), h("h2", null, "Your notes"), v.hasNotes && h("span", { class: "muted small" }, `${v.notesText.length.toLocaleString()} characters`)),
      !v.hasNotes
        ? h("div", { class: "stack" }, h("p", { class: "muted" }, "Add notes and every mode here works from them."), notesInput({}))
        : [
            h(
              "ul",
              { class: "note-list" },
              v.notes.map((n) => {
                const isOpen = openId === n.id;
                return h(
                  "li",
                  { class: "note" },
                  h("button", { type: "button", class: "note-head", "aria-expanded": isOpen, onclick: () => ((openId = isOpen ? null : n.id), draw()) }, h("span", { class: "note-title" }, n.title), h("span", { class: "muted small" }, `${n.text.length.toLocaleString()} chars`), icon("chevron-down", 16)),
                  isOpen && h("div", { class: "note-body" }, h("pre", { class: "note-text" }, n.text), h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => study.removeNote(n.id) }, icon("trash-2"), "Remove"))
                );
              })
            ),
            v.notesText.length > NOTES_AI_CHARS && h("p", { class: "muted small" }, `The AI reads up to ${NOTES_AI_CHARS.toLocaleString()} characters at a time. Quizzes sample different parts each round; chat reads the start.`),
            adding ? notesInput({ onAdded: () => ((adding = false), draw()) }) : h("button", { class: "btn btn-outline", type: "button", onclick: () => ((adding = true), draw()) }, "Add more notes"),
          ]
    );
  };
  draw();
  return { el, draw, unsubscribe: subscribe(draw) };
}

export function needNotes(what) {
  return h("div", { class: "card need-notes" }, icon("notebook-pen", 30), h("h2", null, "Add your notes first"), h("p", { class: "muted" }, `${what} works from your own notes, so paste them below or upload a PDF.`), h("div", { class: "need-input" }, notesInput({ onAdded: () => navigate(location.pathname + location.search, { replace: true }) })));
}

/** Study page frame: content on the left, notes on the right (a drawer on small screens). */
export function studyLayout(ctx, content) {
  const panel = notesPanel();
  ctx.cleanup(panel.unsubscribe);
  const drawerPanel = notesPanel();
  ctx.cleanup(drawerPanel.unsubscribe);
  const dlg = h("dialog", { class: "dlg drawer", "aria-label": "Your notes" }, h("div", { class: "drawer-body" }, drawerPanel.el, h("button", { class: "btn btn-outline", type: "button", onclick: () => dlg.close() }, "Close")));
  dlg.addEventListener("click", (e) => e.target === dlg && dlg.close());
  const fab = h("button", { class: "btn btn-primary btn-lg btn-pill notes-fab", type: "button", onclick: () => dlg.showModal() }, icon("notebook-text"), "Notes");
  const updateFab = () => (fab.lastChild.textContent = ` Notes${study.view().notes.length ? ` (${study.view().notes.length})` : ""}`);
  updateFab();
  ctx.cleanup(subscribe(updateFab));
  ctx.cleanup(() => dlg.remove());
  document.body.append(dlg);
  return h("div", { class: "study-layout" }, h("div", { class: "study-main" }, content), h("aside", { class: "study-side", "aria-label": "Your notes" }, panel.el), fab);
}

export { plural };
