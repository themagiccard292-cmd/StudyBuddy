import { h, mount, icon } from "../dom.js";
import { study, subscribe, classSession } from "../store.js";
import { notesInput } from "../ui.js";
import { navigate } from "../router.js";
import { toast } from "../toast.js";

const MODES = [
  { to: "/quiz", label: "Quiz me", blurb: "One question at a time, with hints before answers.", ic: "circle-help", tone: "blue" },
  { to: "/explain", label: "Explain it back", blurb: "Say it in your own words and get kind, specific feedback.", ic: "pen-line", tone: "indigo" },
  { to: "/chat", label: "Chat", blurb: "Ask questions. Answers come from your notes.", ic: "message-circle", tone: "cyan" },
];

export default function Home(ctx) {
  document.title = "StudyBuddy: study from your own notes";
  const root = h("div", { class: "home" });
  const textareaRef = { current: null };
  let addingMore = false;

  function go(to) {
    if (!study.view().hasNotes) {
      toast("Add your notes first, then pick a mode.");
      textareaRef.current?.focus();
      textareaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    navigate(to);
  }

  function joinStrip() {
    const session = classSession.get();
    if (session) {
      return h("div", { class: "join-strip" }, icon("school", 20), h("p", null, "You're in ", h("b", null, session.className), ` as ${session.firstName}.`), h("a", { class: "btn btn-primary btn-sm btn-pill", href: "/class" }, "Open my class", icon("arrow-right")));
    }
    const code = h("input", { class: "input input-code", maxlength: 6, placeholder: "CODE", "aria-label": "Class code", autocomplete: "off", spellcheck: "false", inputmode: "text" });
    return h("form", { class: "join-strip", onsubmit: (e) => (e.preventDefault(), navigate(`/join${code.value.trim() ? `?code=${encodeURIComponent(code.value.trim().toUpperCase())}` : ""}`)) }, icon("school", 20), h("p", null, h("b", null, "In a class?"), " Enter the code from your teacher."), h("div", { class: "join-controls" }, code, h("button", { class: "btn btn-primary btn-pill", type: "submit" }, "Join class", icon("arrow-right"))));
  }

  function draw() {
    const v = study.view();
    mount(
      root,
      joinStrip(),
      h(
        "section",
        { class: "hero" },
        h("div", null, h("h1", { class: "hero-title" }, "Add your ", h("span", { class: "swipe" }, "notes")), h("p", { class: "lede" }, "Paste them or drop in a PDF. StudyBuddy quizzes you on what's actually in them, and helps you understand the rest.")),
        h("div", { class: "stats", "aria-label": "Your progress" }, h("div", { class: `stat${v.currentStreak > 0 ? " hot" : ""}` }, icon("flame", 20), h("b", null, v.currentStreak), h("span", null, "day streak")), h("div", { class: "stat" }, icon("trophy", 20), h("b", null, v.masteredTopics.length), h("span", null, "topics mastered")))
      ),
      h(
        "section",
        { "aria-label": "Your notes" },
        v.hasNotes
          ? h(
              "div",
              { class: "card ready" },
              h("div", { class: "row row-between" }, h("div", { class: "grow" }, h("p", { class: "ready-title" }, `${v.notes.length === 1 ? "1 set of notes" : `${v.notes.length} sets of notes`} ready`), h("p", { class: "muted ready-meta" }, `${v.notes.map((n) => n.title).join(" · ")} · ${v.notesText.length.toLocaleString()} characters`)), h("button", { class: "btn btn-outline", type: "button", onclick: () => ((addingMore = !addingMore), draw()) }, icon("plus"), addingMore ? "Close" : "Add more")),
              addingMore && notesInput({ onAdded: () => ((addingMore = false), draw()) })
            )
          : notesInput({ variant: "hero", textareaRef })
      ),
      h(
        "section",
        { class: "modes", "aria-label": "Choose how to study" },
        MODES.map((m) => h("button", { type: "button", class: `mode tone-${m.tone}${v.hasNotes ? "" : " idle"}`, onclick: () => go(m.to) }, h("span", { class: "mode-chip" }, icon(m.ic, 24)), h("span", { class: "mode-label" }, m.label), h("span", { class: "mode-blurb2" }, m.blurb)))
      ),
      h(
        "section",
        { class: "more", "aria-label": "More ways to study" },
        [["/cards", "layers", "Flashcards"], ["/practice", "calculator", "Practice problems"], ["/test", "clipboard-check", "Take a test"]].map(([to, ic, label]) => h("button", { type: "button", class: "pill", onclick: () => go(to) }, icon(ic, 17), label)),
        h("button", { type: "button", class: "pill", onclick: () => go("/weak-spots") }, icon("target", 17), "Weak spots", v.weakTopics.length > 0 && h("span", { class: "count" }, v.weakTopics.length))
      ),
      h("p", { class: "muted small" }, "Your notes and progress stay in this browser. No ads, no tracking, no accounts for students. ", h("a", { href: "/login?role=teacher" }, "Teacher? Log in or sign up."))
    );
  }
  draw();
  // Redraw only when something shown here changed, so text typed into the notes box or class-code box isn't lost.
  const signature = () => {
    const v = study.view();
    return [v.notes.length, v.currentStreak, v.masteredTopics.length, v.weakTopics.length, classSession.get()?.classId ?? ""].join("|");
  };
  let last = signature();
  const redraw = () => {
    const now = signature();
    if (now !== last) {
      last = now;
      draw();
    }
  };
  ctx.cleanup(subscribe(redraw));
  ctx.cleanup(classSession.subscribe(redraw)); // e.g. a class picked by an account that has since logged out is dropped

  return root;
}
