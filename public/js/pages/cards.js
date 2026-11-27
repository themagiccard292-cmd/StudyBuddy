import { h, mount, icon, spinner } from "../dom.js";
import { rich } from "../rich.js";
import { study } from "../store.js";
import { api } from "../api.js";
import { studyLayout, modeHeader, needNotes, segmented, field } from "../ui.js";

export default function CardsPage(ctx) {
  document.title = "Flashcards | StudyBuddy";
  const content = h("div");
  let order = null; // ids still to learn this session
  let flipped = false;
  let busy = false;
  let error = "";
  let count = 12;
  let deckKey = "";
  const missedOnce = new Set();

  function ensureQueue(v) {
    const key = v.cards.map((c) => c.id).join(",");
    if (key !== deckKey || order === null) {
      deckKey = key;
      missedOnce.clear();
      order = v.cards.filter((c) => !v.knownCards.includes(c.id)).map((c) => c.id);
      flipped = false;
    }
  }

  async function make() {
    busy = true;
    error = "";
    draw();
    try {
      const v = study.view();
      const res = await api.post("/api/ai/flashcards", { notes: v.notesText, count, avoid: v.cards.map((c) => c.front.slice(0, 120)).slice(-30) });
      study.setCards(res.cards);
      order = null;
    } catch (e) {
      error = e.message;
    }
    busy = false;
    draw();
  }

  function answer(known) {
    const v = study.view();
    const card = v.cards.find((c) => c.id === order[0]);
    if (!card) return;
    if (known) {
      study.markCard(card.id, true);
      study.recordAnswer(card.topic, !missedOnce.has(card.id));
      order = order.slice(1);
    } else {
      missedOnce.add(card.id);
      order = [...order.slice(1), order[0]];
    }
    flipped = false;
    draw();
  }

  function restart() {
    study.resetKnownCards();
    missedOnce.clear();
    order = study.view().cards.map((c) => c.id).sort(() => Math.random() - 0.5);
    flipped = false;
    draw();
  }

  function setup() {
    const seg = segmented({ label: "Number of cards", value: count, options: [[8, "8"], [12, "12"], [20, "20"]], onChange: (v) => (count = v) });
    return h("div", { class: "card stack-lg" }, field("How many cards", seg), h("div", { class: "row" }, h("button", { class: "btn btn-primary btn-lg", type: "button", disabled: busy, onclick: make }, busy ? [spinner(), "Making cards…"] : [icon("sparkles"), "Make flashcards"])), error && h("p", { class: "form-error", role: "alert" }, error));
  }

  function draw() {
    const v = study.view();
    const head = modeHeader({ title: "Flashcards", blurb: "Flip, think, then tell me if you knew it. Cards you miss come back around.", ic: "layers" });
    if (!v.hasNotes) return mount(content, head, needNotes("Flashcards"));
    ensureQueue(v);
    if (v.cards.length === 0) return mount(content, head, setup());

    const done = order.length === 0;
    if (done) {
      return mount(content, head, h("div", { class: "stack-lg" }, h("div", { class: "card stack" }, h("h2", { class: "done-title" }, "Deck complete"), h("p", null, `You knew all ${v.cards.length} cards. Nice work.`), h("div", { class: "row" }, h("button", { class: "btn btn-outline", type: "button", onclick: restart }, icon("shuffle"), "Go through it again"), h("button", { class: "btn btn-primary", type: "button", disabled: busy, onclick: make }, busy ? [spinner(), "Making cards…"] : [icon("sparkles"), "Make new cards"]))), error && h("p", { class: "form-error" }, error)));
    }

    const card = v.cards.find((c) => c.id === order[0]);
    const known = v.knownCards.length;
    const flip = () => ((flipped = !flipped), scene.firstChild.classList.toggle("flipped", flipped), btns.forEach((b) => (b.disabled = !flipped)));
    const scene = h("div", { class: "scene", role: "button", tabindex: 0, "aria-label": "Flashcard. Press to flip.", onclick: flip, onkeydown: (e) => (e.key === " " || e.key === "Enter") && (e.preventDefault(), flip()) },
      h("div", { class: `flashcard${flipped ? " flipped" : ""}` },
        h("div", { class: "face front" }, h("span", { class: "tag" }, card.topic), h("div", { class: "face-text" }, rich(card.front)), h("span", { class: "flip-hint" }, "Tap to flip")),
        h("div", { class: "face back" }, h("span", { class: "tag" }, "Answer"), h("div", { class: "face-text" }, rich(card.back)))));
    const btns = [
      h("button", { class: "btn btn-outline btn-lg", type: "button", disabled: !flipped, onclick: () => answer(false) }, icon("rotate-ccw"), "Still learning"),
      h("button", { class: "btn btn-primary btn-lg", type: "button", disabled: !flipped, onclick: () => answer(true) }, icon("check"), "I knew it"),
    ];
    mount(content, head, h("div", { class: "study-cards" }, h("div", { class: "meter wide" }, h("div", { class: "meter-fill", style: { width: `${(known / v.cards.length) * 100}%` } })), h("p", { class: "muted small" }, `${known} of ${v.cards.length} known · ${order.length} left`), scene, h("div", { class: "row center-row" }, btns), h("button", { class: "btn btn-ghost btn-sm", type: "button", disabled: busy, onclick: make }, icon("sparkles"), "Replace with a new deck"), error && h("p", { class: "form-error" }, error)));
  }
  draw();
  return studyLayout(ctx, content);
}
