import { h, mount, icon } from "../dom.js";
import { rich } from "../rich.js";
import { study } from "../store.js";
import { api } from "../api.js";
import { studyLayout, modeHeader, needNotes } from "../ui.js";

const STARTERS = ["What are the most important ideas in my notes?", "Explain the hardest part to me simply.", "Give me a quick example to help it click.", "What should I review first?"];

export default function ChatPage(ctx) {
  document.title = "Chat | StudyBuddy";
  const content = h("div");
  let busy = false;
  let error = "";
  let draftText = "";

  async function send(text) {
    const content_ = text.trim();
    if (!content_ || busy) return;
    const messages = [...study.view().chat, { role: "user", content: content_ }];
    study.setChat(messages);
    draftText = "";
    busy = true;
    error = "";
    draw(true);
    try {
      const res = await api.post("/api/ai/chat", { notes: study.view().notesText, messages });
      study.setChat([...messages, { role: "assistant", content: res.reply }]);
    } catch (e) {
      error = e.message;
    }
    busy = false;
    draw(true);
  }

  async function retry() {
    const messages = study.view().chat;
    busy = true;
    error = "";
    draw(true);
    try {
      const res = await api.post("/api/ai/chat", { notes: study.view().notesText, messages });
      study.setChat([...messages, { role: "assistant", content: res.reply }]);
    } catch (e) {
      error = e.message;
    }
    busy = false;
    draw(true);
  }

  function draw(scroll = false) {
    const v = study.view();
    const head = modeHeader({
      title: "Chat",
      blurb: "Ask about anything in your notes. I'll stick to them unless you tell me to go beyond.",
      ic: "message-circle",
      actions: v.chat.length > 0 && h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => (study.setChat([]), draw()) }, icon("trash-2"), "Clear chat"),
    });
    if (!v.hasNotes) return mount(content, head, needNotes("Chat"));

    const input = h("textarea", { class: "textarea", rows: 2, maxlength: 4000, placeholder: "Ask about your notes…", "aria-label": "Your message", value: draftText, oninput: (e) => ((draftText = e.target.value), (sendBtn.disabled = busy || !draftText.trim())), onkeydown: (e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send(draftText)) });
    const sendBtn = h("button", { class: "btn btn-primary btn-lg btn-icon", type: "submit", "aria-label": "Send", disabled: busy || !draftText.trim() }, icon("send-horizontal"));
    const log = h("div", { class: "chat-log", "aria-live": "polite" },
      v.chat.length === 0 && h("div", { class: "starters" }, h("p", { class: "muted" }, "Try one of these, or ask your own:"), h("div", { class: "row" }, STARTERS.map((s) => h("button", { type: "button", class: "starter", onclick: () => send(s) }, s)))),
      v.chat.map((m) => h("div", { class: `msg ${m.role === "user" ? "user" : "bot"}` }, m.role === "user" ? m.content : rich(m.content))),
      busy && h("div", { class: "msg bot", "aria-label": "StudyBuddy is typing" }, h("span", { class: "typing" }, h("i"), h("i"), h("i"))),
      error && h("div", { class: "form-error row", role: "alert" }, h("span", { class: "grow" }, error), h("button", { class: "btn btn-outline btn-sm", type: "button", onclick: retry }, "Try again"))
    );
    mount(content, head, h("div", { class: "card chat" }, log, h("form", { class: "composer", onsubmit: (e) => (e.preventDefault(), send(draftText)) }, input, sendBtn)));
    if (scroll) log.scrollTop = log.scrollHeight;
    if (scroll && !busy) input.focus();
  }
  draw(true);
  return studyLayout(ctx, content);
}
