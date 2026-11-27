import { h, mount, icon } from "../dom.js";
import { study } from "../store.js";
import { studyLayout, modeHeader, needNotes, segmented, field } from "../ui.js";
import { createRunner } from "../runner.js";

export default function PracticePage(ctx) {
  document.title = "Practice problems | StudyBuddy";
  const content = h("div");
  let running = null;
  let round = 0;

  function draw() {
    const head = modeHeader({ title: "Practice problems", blurb: "Worked problems built from your notes or curriculum. Try each one, ask for a hint, then see the steps.", ic: "calculator" });
    if (!study.view().hasNotes) return mount(content, head, needNotes("Practice problems"));
    if (running) return mount(content, head, createRunner({ kind: "problems", mix: "short", ...running, onAgain: () => (round++, draw()), onExit: () => ((running = null), draw()) }));
    const count = segmented({ label: "Number of problems", value: 5, options: [[3, "3"], [5, "5"], [8, "8"]] });
    const level = segmented({ label: "Difficulty", value: "standard", options: [["easier", "Easier"], ["standard", "Standard"], ["harder", "Harder"]] });
    mount(
      content,
      head,
      h("div", { class: "card stack-lg" }, h("div", { class: "row setup-row" }, field("How many", count), field("Level", level)), h("div", { class: "row" }, h("button", { class: "btn btn-primary btn-lg", type: "button", onclick: () => ((running = { count: count.value, difficulty: level.value }), round++, draw()) }, icon("play"), "Start practice")), h("p", { class: "muted small" }, "Problems fit your subject: calculations, applied tasks or scenarios to reason through."))
    );
  }
  draw();
  return studyLayout(ctx, content);
}
