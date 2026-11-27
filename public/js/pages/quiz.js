import { h, mount, icon } from "../dom.js";
import { study } from "../store.js";
import { studyLayout, modeHeader, needNotes, segmented, field } from "../ui.js";
import { createRunner } from "../runner.js";
import { navigate } from "../router.js";

export default function QuizPage(ctx) {
  document.title = "Quiz me | StudyBuddy";
  const content = h("div");
  let config = null;
  let round = 0;

  const weakStart = () => {
    const weak = study.view().weakTopics;
    return weak.length ? { mix: "mixed", count: 5, difficulty: "standard", focusTopics: weak.slice(0, 4).map((t) => t.name) } : null;
  };
  if (ctx.query.get("weak") === "1") config = weakStart();

  function draw() {
    const v = study.view();
    const weakMode = Boolean(config?.focusTopics.length);
    const head = modeHeader({ title: weakMode ? "Weak-spot practice" : "Quiz me", blurb: weakMode ? `Focusing on: ${config.focusTopics.join(", ")}.` : "Questions from your notes, one at a time. Hints come before answers.", ic: weakMode ? "target" : "circle-help" });
    if (!v.hasNotes) return mount(content, head, needNotes("Quiz mode"));
    if (config) {
      return mount(content, head, createRunner({ kind: "quiz", ...config, onAgain: () => (round++, draw()), onExit: () => ((config = null), navigate("/quiz", { replace: true }), draw()) }));
    }
    const mix = segmented({ label: "Question types", value: "mixed", options: [["mixed", "Mixed"], ["mc", "Multiple choice"], ["short", "Short answer"]] });
    const count = segmented({ label: "Number of questions", value: 5, options: [[5, "5"], [8, "8"], [10, "10"]] });
    const level = segmented({ label: "Difficulty", value: "standard", options: [["easier", "Easier"], ["standard", "Standard"], ["harder", "Harder"]] });
    const weak = v.weakTopics.length > 0;
    mount(
      content,
      head,
      h(
        "div",
        { class: "card stack-lg" },
        h("div", { class: "row setup-row" }, field("Question types", mix), field("How many", count), field("Level", level)),
        h("div", { class: "row" }, h("button", { class: "btn btn-primary btn-lg", type: "button", onclick: () => ((config = { mix: mix.value, count: count.value, difficulty: level.value, focusTopics: [] }), round++, draw()) }, icon("play"), "Start quiz"), weak && h("button", { class: "btn btn-outline btn-lg", type: "button", onclick: () => ((config = weakStart()), round++, draw()) }, icon("target"), "Practice my weak spots")),
        h("p", { class: "muted small" }, "Wrong answers get a hint first. You can always ask for the answer when you're stuck.")
      )
    );
  }
  draw();
  return studyLayout(ctx, content);
}
