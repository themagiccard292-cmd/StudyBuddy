import { h, mount, icon } from "../dom.js";
import { study, subscribe } from "../store.js";
import { studyLayout, modeHeader } from "../ui.js";

export default function WeakSpots(ctx) {
  document.title = "Weak spots | StudyBuddy";
  const content = h("div", { class: "stack-lg" });
  let confirm = false;

  function draw() {
    const v = study.view();
    mount(
      content,
      modeHeader({ title: "Weak spots", blurb: "Topics you keep missing show up here. Get three right in a row and they're cleared.", ic: "target" }),
      h("div", { class: "stats-row" },
        h("div", { class: `stat${v.currentStreak > 0 ? " hot" : ""}` }, icon("flame", 20), h("b", null, v.currentStreak), h("span", null, `day streak (best ${v.streak.best})`)),
        h("div", { class: "stat" }, icon("trophy", 20), h("b", null, v.masteredTopics.length), h("span", null, "topics mastered")),
        h("div", { class: "stat" }, icon("target", 20), h("b", null, `${v.totals.answered ? Math.round((v.totals.firstTry / v.totals.answered) * 100) : 0}%`), h("span", null, "right on the first try"))
      ),
      h("section", { class: "card stack" },
        h("div", { class: "row row-between" }, h("h2", { class: "card-title" }, "Needs practice"), v.weakTopics.length > 0 && v.hasNotes && h("a", { class: "btn btn-primary", href: "/quiz?weak=1" }, icon("target"), "Practice my weak spots")),
        v.weakTopics.length === 0
          ? h("p", { class: "muted" }, "Nothing here yet. When you miss the same topic twice, it lands here so you can practice it.")
          : h("ul", { class: "weak-list" }, v.weakTopics.map((t) => h("li", { class: "weak-item" }, h("div", { class: "grow" }, h("b", null, t.name), h("p", { class: "muted small" }, `missed ${t.misses}×, ${Math.round((t.correct / Math.max(1, t.seen)) * 100)}% right overall`), h("div", { class: "meter" }, h("div", { class: "meter-fill ok", style: { width: `${Math.min(100, (t.run / 3) * 100)}%` } }))), h("span", { class: "muted small" }, `${t.run} of 3 right in a row`))))
      ),
      h("section", { class: "card stack" }, h("h2", { class: "card-title" }, "Mastered"), v.masteredTopics.length === 0 ? h("p", { class: "muted" }, "Answer a topic right three times in a row and it counts as mastered.") : h("div", { class: "row" }, v.masteredTopics.map((t) => h("span", { class: "chip chip-ok" }, t.name)))),
      (v.totals.answered > 0 || v.weakTopics.length > 0) && h("div", { class: "row end" }, h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => (confirm ? (study.resetProgress(), (confirm = false)) : (confirm = true), draw()), onblur: () => confirm && ((confirm = false), draw()) }, icon("trash-2"), confirm ? "Click again to erase progress" : "Reset my progress"))
    );
  }
  draw();
  ctx.cleanup(subscribe(draw));
  return studyLayout(ctx, content);
}
