import { h, mount, icon, spinner } from "../dom.js";
import { rich, richInline } from "../rich.js";
import { study } from "../store.js";
import { api } from "../api.js";
import { studyLayout, modeHeader, needNotes } from "../ui.js";

const VERDICT = {
  solid: ["Solid explanation", "You covered the idea clearly."],
  partly: ["Getting there", "The core is here, with a few gaps to fill."],
  needs_work: ["Let's build this up", "A good start. Let's sharpen it together."],
};

export default function ExplainPage(ctx) {
  document.title = "Explain it back | StudyBuddy";
  const content = h("div");
  let concept = "";
  let text = "";
  let feedback = null;
  let busy = false;
  let error = "";

  async function submit() {
    busy = true;
    error = "";
    draw();
    try {
      const res = await api.post("/api/ai/explain", { notes: study.view().notesText, concept, explanation: text });
      feedback = res.feedback;
      const topic = feedback.topic || concept;
      if (feedback.verdict === "solid") study.recordAnswer(topic, true);
      else if (feedback.verdict === "needs_work") study.recordAnswer(topic, false);
      else study.recordActivity();
    } catch (e) {
      error = e.message;
    }
    busy = false;
    draw();
  }

  function draw() {
    const v = study.view();
    const head = modeHeader({ title: "Explain it back", blurb: "Pick a concept and explain it like you're teaching a friend. I'll point out what's missing, kindly.", ic: "pen-line" });
    if (!v.hasNotes) return mount(content, head, needNotes("Explain-it-back"));

    const suggestions = Object.values(v.topics).sort((a, b) => b.lastAt - a.lastAt).slice(0, 5).map((t) => t.name);
    let submitBtn;
    const conceptInput = h("input", { class: "input", id: "concept", maxlength: 200, value: concept, placeholder: "A concept, term or process from your notes", oninput: (e) => ((concept = e.target.value), refresh()) });
    const area = h("textarea", { class: "textarea", id: "explanation", rows: 7, maxlength: 4000, value: text, placeholder: "Write it in your own words. It doesn't have to be perfect.", oninput: (e) => ((text = e.target.value), (counter.textContent = `${text.length}/4000`), refresh()) });
    const counter = h("span", { class: "muted small counter" }, `${text.length}/4000`);
    const refresh = () => submitBtn && (submitBtn.disabled = busy || concept.trim().length < 2 || text.trim().length < 15);
    submitBtn = h("button", { class: "btn btn-primary btn-lg", type: "button", onclick: submit }, busy ? [spinner(), "Reading your explanation…"] : "Check my explanation");
    refresh();

    const section = (cls, ic, title, items) => items.length > 0 && h("section", { class: "fb-block" }, h("h2", { class: "fb-title" }, icon(ic, 18, ), title), h("ul", null, items.map((i) => h("li", null, richInline(i)))));

    mount(
      content,
      head,
      h("div", { class: "stack-lg" },
        h("div", { class: "card stack" }, h("label", { class: "label", for: "concept" }, "What are you explaining?"), conceptInput, suggestions.length > 0 && h("div", { class: "row small muted" }, "Recent topics:", suggestions.map((s) => h("button", { type: "button", class: "chip suggest", onclick: () => ((concept = s), draw()) }, s))), h("label", { class: "label", for: "explanation" }, "Your explanation"), area, h("div", { class: "row" }, submitBtn, counter), error && h("p", { class: "form-error", role: "alert" }, error)),
        feedback &&
          h(
            "div",
            { class: "card stack result" },
            h("div", { class: `verdict ${feedback.verdict}` }, h("b", null, VERDICT[feedback.verdict][0]), h("span", null, VERDICT[feedback.verdict][1])),
            section("ok", "circle-check", "What you got right", feedback.covered),
            section("gap", "circle-dashed", "What's missing", feedback.missing),
            section("fix", "triangle-alert", "Worth fixing", feedback.mistakes),
            feedback.encouragement && h("p", { class: "margin-note" }, feedback.encouragement),
            feedback.nextStep && h("p", { class: "next-step" }, h("b", null, "Next: "), richInline(feedback.nextStep)),
            h("div", { class: "row" }, h("button", { class: "btn btn-outline", type: "button", onclick: () => (area.focus(), area.scrollIntoView({ behavior: "smooth", block: "center" })) }, icon("arrow-right"), "Revise my explanation"), h("button", { class: "btn btn-ghost", type: "button", onclick: () => ((feedback = null), (text = ""), (concept = ""), draw()) }, icon("rotate-ccw"), "Explain something else"))
          )
      )
    );
  }
  draw();
  return studyLayout(ctx, content);
}
