import { h, mount, icon, spinner, plural, pts } from "../dom.js";
import { rich } from "../rich.js";
import { api } from "../api.js";
import { navigate } from "../router.js";
import { toast } from "../toast.js";
import { extractFileText } from "../pdf.js";
import { dialog, errorBox, segmented, field } from "../ui.js";
import { requireTeacher } from "./_auth.js";

const newId = () => Math.random().toString(16).slice(2, 10);
const blank = () => ({ id: newId(), type: "mc", topic: "", question: "", choices: ["", "", "", ""], correctIndex: 0, answer: "", explanation: "", points: 1 });
const toLocalInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const STARTERS = ["Make 8 questions from the curriculum", "Make 10 multiple choice questions, easy to medium", "Write 5 short-answer questions that check understanding"];

export default async function Builder(ctx) {
  const user = await requireTeacher();
  if (!user) return h("div");
  const classId = ctx.params.id;
  const hid = ctx.params.hid;

  let data;
  let hw = null;
  try {
    data = await api.get(`/api/teacher/classes/${classId}`);
    if (hid !== "new") {
      hw = await api.get(`/api/teacher/homework/${hid}`);
      if (String(hw.classId) !== String(classId)) throw new Error("That homework isn't in this class.");
    }
  } catch (e) {
    return h("div", { class: "card stack" }, h("p", { class: "form-error" }, e.message), h("a", { class: "btn btn-primary", href: "/teacher" }, "Back to classes"));
  }
  document.title = `${hw ? "Edit homework" : "New homework"} | StudyBuddy`;

  const s = {
    id: hw?.id ?? null,
    title: hw?.title ?? "",
    instructions: hw?.instructions ?? "",
    status: hw?.status ?? "draft",
    curriculumId: hw?.curriculumId ?? (data.curricula[0]?.id ?? ""),
    dueAt: toLocalInput(hw?.dueAt),
    questions: structuredClone(hw?.questions ?? []),
    submissions: hw?.submissionCount ?? 0,
  };
  const chat = { messages: [], busy: false, error: "", textbook: "", textbookName: "", draftText: "" };

  const chatEl = h("section", { class: "card builder-chat" });
  const draftEl = h("section", { class: "builder-draft stack" });
  const saveErr = errorBox();
  let saving = false;

  // ---------- AI chat ----------
  async function send(text) {
    const msg = text.trim();
    if (!msg || chat.busy) return;
    chat.messages.push({ role: "user", content: msg });
    chat.draftText = "";
    chat.busy = true;
    chat.error = "";
    drawChat(true);
    try {
      const res = await api.post(`/api/teacher/classes/${classId}/homework/chat`, {
        curriculumId: s.curriculumId || undefined,
        textbook: chat.textbook,
        messages: chat.messages,
        draft: s.questions.map((q) => ({ type: q.type, topic: q.topic, question: q.question })),
      });
      chat.messages.push({ role: "assistant", content: res.reply });
      if (res.title && !s.title.trim()) s.title = res.title;
      if (res.instructions && !s.instructions.trim()) s.instructions = res.instructions;
      if (res.questions) {
        s.questions = res.questions;
        toast(`Draft updated: ${plural(res.questions.length, "question")}`);
      }
      drawDraft();
    } catch (e) {
      chat.error = e.message;
    }
    chat.busy = false;
    drawChat(true);
  }

  function textbookDialog() {
    const area = h("textarea", { class: "textarea", rows: 9, placeholder: "Paste the chapter or pages the homework should come from…", value: chat.textbook });
    const file = h("input", { type: "file", accept: ".pdf,.txt,.md,application/pdf,text/plain", class: "file-input", "aria-label": "Upload a PDF or text file" });
    const status = h("span", { class: "muted small" });
    const err = errorBox();
    file.addEventListener("change", async () => {
      const f = file.files[0];
      if (!f) return;
      status.replaceChildren(spinner(), " Reading file…");
      try {
        area.value = await extractFileText(f);
        chat.textbookName = f.name;
        status.textContent = `Loaded ${area.value.length.toLocaleString()} characters`;
      } catch (e) {
        status.textContent = "";
        err.show(e.message);
      }
    });
    dialog({
      title: "Use a textbook",
      body: h("div", { class: "stack" }, err, h("p", { class: "muted" }, "Paste text or upload a PDF. The AI will write questions from it. It's used for this conversation only and isn't stored."), area, h("div", { class: "row" }, h("label", { class: "btn btn-outline btn-sm" }, icon("upload"), "Upload PDF or text", file), status)),
      actions: (close) => [
        chat.textbook && h("button", { class: "btn btn-ghost", type: "button", onclick: () => ((chat.textbook = ""), (chat.textbookName = ""), close("clear"), drawChat()) }, "Remove textbook"),
        h("button", { class: "btn btn-primary", type: "button", onclick: () => ((chat.textbook = area.value.trim()), !chat.textbook && (chat.textbookName = ""), close("ok"), drawChat()) }, "Use this text"),
      ],
    });
  }

  function drawChat(scroll = false) {
    const input = h("textarea", { class: "textarea", rows: 2, maxlength: 4000, placeholder: "Tell the AI what you want: topic, number of questions, difficulty, style…", "aria-label": "Message to the AI", value: chat.draftText, oninput: (e) => ((chat.draftText = e.target.value), (sendBtn.disabled = chat.busy || !chat.draftText.trim())), onkeydown: (e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send(chat.draftText)) });
    const sendBtn = h("button", { class: "btn btn-primary btn-icon btn-lg", type: "submit", "aria-label": "Send", disabled: chat.busy || !chat.draftText.trim() }, icon("send-horizontal"));
    const select = h("select", { class: "select", "aria-label": "Curriculum for the AI to follow", onchange: (e) => (s.curriculumId = e.target.value ? Number(e.target.value) : "") }, h("option", { value: "" }, "No curriculum"), data.curricula.map((c) => h("option", { value: c.id, selected: String(c.id) === String(s.curriculumId) }, c.title)));
    const log = h("div", { class: "chat-log", "aria-live": "polite" },
      chat.messages.length === 0 && h("div", { class: "starters" }, h("p", { class: "muted" }, data.curricula.length ? "Describe the homework you want. The AI follows the curriculum you pick." : "Describe the homework you want. Add a curriculum or textbook so the AI follows your material."), h("div", { class: "row" }, STARTERS.map((t) => h("button", { type: "button", class: "starter", onclick: () => send(t) }, t)))),
      chat.messages.map((m) => h("div", { class: `msg ${m.role === "user" ? "user" : "bot"}` }, m.role === "user" ? m.content : rich(m.content))),
      chat.busy && h("div", { class: "msg bot" }, h("span", { class: "typing" }, h("i"), h("i"), h("i"))),
      chat.error && h("div", { class: "form-error", role: "alert" }, chat.error)
    );
    mount(chatEl,
      h("div", { class: "row row-between" }, h("h2", { class: "card-title" }, icon("bot", 20), " Plan it with the AI")),
      h("div", { class: "builder-sources" }, field("Curriculum", select), h("div", { class: "field" }, h("span", { class: "label" }, "Textbook"), h("button", { class: "btn btn-outline", type: "button", onclick: textbookDialog }, icon("book-open"), chat.textbook ? `${chat.textbookName || "Pasted text"} (${chat.textbook.length.toLocaleString()} chars)` : "Add textbook text"))),
      log,
      h("form", { class: "composer", onsubmit: (e) => (e.preventDefault(), send(chat.draftText)) }, input, sendBtn)
    );
    if (scroll) {
      log.scrollTop = log.scrollHeight;
      if (!chat.busy) input.focus();
    }
  }

  // ---------- draft editor ----------
  function convert(q, type) {
    if (type === q.type) return;
    q.type = type;
    if (type === "mc") {
      q.choices = q.choices?.length === 4 ? q.choices : ["", "", "", ""];
      q.correctIndex = q.correctIndex ?? 0;
      q.answer = q.choices[q.correctIndex] ?? "";
    } else {
      q.points = q.points === 1 ? 2 : q.points;
    }
    drawDraft();
  }

  function move(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= s.questions.length) return;
    [s.questions[i], s.questions[j]] = [s.questions[j], s.questions[i]];
    drawDraft();
  }

  function questionCard(q, i) {
    const bind = (el, key) => (el.addEventListener("input", () => (q[key] = el.value)), el);
    return h("article", { class: "card q-edit" },
      h("div", { class: "row row-between" },
        h("div", { class: "row" }, h("span", { class: "num" }, i + 1), segmented({ label: `Question ${i + 1} type`, value: q.type, options: [["mc", "Multiple choice"], ["short", "Short answer"]], onChange: (v) => convert(q, v) })),
        h("div", { class: "row tight" }, h("button", { class: "btn btn-ghost btn-sm btn-icon", type: "button", "aria-label": "Move up", disabled: i === 0, onclick: () => move(i, -1) }, iconRot("up")), h("button", { class: "btn btn-ghost btn-sm btn-icon", type: "button", "aria-label": "Move down", disabled: i === s.questions.length - 1, onclick: () => move(i, 1) }, iconRot("down")), h("button", { class: "btn btn-ghost btn-sm btn-icon", type: "button", "aria-label": "Delete question", onclick: () => (s.questions.splice(i, 1), drawDraft()) }, icon("trash-2")))),
      field("Question", bind(h("textarea", { class: "textarea", rows: 2, value: q.question, placeholder: "Write the question…" }), "question")),
      q.type === "mc"
        ? h("div", { class: "field" }, h("span", { class: "label" }, "Choices ", h("span", { class: "muted small" }, "(select the correct one)")), h("div", { class: "stack tight-stack" }, q.choices.map((c, ci) => h("div", { class: "choice-edit" }, h("input", { type: "radio", name: `correct-${q.id}`, "aria-label": `Choice ${"ABCD"[ci]} is correct`, checked: q.correctIndex === ci, onchange: () => (q.correctIndex = ci) }), h("span", { class: "letter" }, "ABCD"[ci]), h("input", { class: "input", value: c, placeholder: `Choice ${"ABCD"[ci]}`, "aria-label": `Choice ${"ABCD"[ci]}`, oninput: (e) => (q.choices[ci] = e.target.value) })))))
        : field("Model answer", bind(h("textarea", { class: "textarea", rows: 2, value: q.answer, placeholder: "What a correct answer says. The AI grades students against this." }), "answer")),
      h("div", { class: "row end-grid" }, field("Explanation shown after submitting", bind(h("input", { class: "input", value: q.explanation, placeholder: "One or two sentences" }), "explanation")), field("Topic", bind(h("input", { class: "input", value: q.topic, placeholder: "e.g. Cells", maxlength: 60 }), "topic")), field("Points", h("input", { class: "input pts", type: "number", min: 0, max: 100, step: 0.5, value: q.points, oninput: (e) => (q.points = Number(e.target.value)) })))
    );
  }

  function iconRot(dir) {
    const i = icon("arrow-left");
    i.style.transform = dir === "up" ? "rotate(90deg)" : "rotate(-90deg)";
    return i;
  }

  async function save(status) {
    if (saving) return;
    saving = true;
    saveErr.clear();
    drawDraft();
    try {
      const body = {
        title: s.title,
        instructions: s.instructions,
        status,
        curriculumId: s.curriculumId || null,
        dueAt: s.dueAt ? new Date(s.dueAt).toISOString() : null,
        questions: s.questions.map((q) => ({ ...q, answer: q.type === "mc" ? (q.choices[q.correctIndex] ?? "") : q.answer, points: Number(q.points) })),
      };
      if (s.id) await api.put(`/api/teacher/homework/${s.id}`, body);
      else s.id = (await api.post(`/api/teacher/classes/${classId}/homework`, body)).id;
      s.status = status;
      saving = false;
      if (status === "published") {
        toast("Published to the class");
        navigate(`/teacher/classes/${classId}`);
        return;
      }
      toast("Draft saved");
      history.replaceState({}, "", `/teacher/classes/${classId}/homework/${s.id}`);
      drawDraft();
    } catch (e) {
      saving = false;
      drawDraft();
      saveErr.show(e.message);
      saveErr.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function drawDraft() {
    const total = s.questions.reduce((n, q) => n + (Number(q.points) || 0), 0);
    mount(draftEl,
      h("div", { class: "card stack" },
        h("h2", { class: "card-title" }, icon("pencil", 20), " Your homework"),
        s.submissions > 0 && h("p", { class: "form-error" }, `${plural(s.submissions, "student")} already handed this in. Changing questions won't re-grade their results.`),
        field("Title", h("input", { class: "input", value: s.title, maxlength: 120, placeholder: "Unit 3 review", oninput: (e) => (s.title = e.target.value) })),
        field("Instructions for students", h("textarea", { class: "textarea", rows: 2, value: s.instructions, placeholder: "Optional", oninput: (e) => (s.instructions = e.target.value) })),
        field("Due date", h("input", { class: "input", type: "datetime-local", value: s.dueAt, oninput: (e) => (s.dueAt = e.target.value) }), "Optional. Students can still hand it in late.")
      ),
      s.questions.length === 0
        ? h("div", { class: "card center stack empty" }, icon("sparkles", 30), h("h3", { class: "card-title" }, "No questions yet"), h("p", { class: "muted" }, "Ask the AI on the left to draft some, or add your own."))
        : s.questions.map(questionCard),
      h("div", { class: "row" }, h("button", { class: "btn btn-outline", type: "button", onclick: () => (s.questions.push(blank()), drawDraft(), draftEl.lastElementChild?.previousElementSibling?.scrollIntoView?.({ behavior: "smooth", block: "center" })) }, icon("plus"), "Add a question"), h("span", { class: "muted small" }, `${plural(s.questions.length, "question")} · ${pts(total)}`)),
      saveErr,
      h("div", { class: "row save-bar" },
        h("button", { class: "btn btn-primary btn-lg", type: "button", disabled: saving, onclick: () => save("published") }, saving ? [spinner(), "Saving…"] : s.status === "published" ? "Save changes" : "Publish to class"),
        h("button", { class: "btn btn-outline btn-lg", type: "button", disabled: saving, onclick: () => save("draft") }, s.status === "published" ? "Unpublish (save as draft)" : "Save as draft"),
        h("a", { class: "btn btn-ghost btn-lg", href: `/teacher/classes/${classId}` }, "Back")
      )
    );
  }

  drawChat();
  drawDraft();
  return h("div", { class: "stack-lg" },
    h("a", { class: "btn btn-ghost btn-sm back", href: `/teacher/classes/${classId}` }, icon("arrow-left"), data.cls.name),
    h("div", { class: "mode-header" }, h("span", { class: "mode-icon" }, icon("sparkles", 26)), h("div", { class: "grow" }, h("h1", { class: "mode-title" }, hw ? "Edit homework" : "New homework"), h("p", { class: "mode-blurb" }, "Chat with the AI about what you want. It drafts the questions; you edit anything, then publish."))),
    h("div", { class: "builder" }, chatEl, draftEl)
  );
}
