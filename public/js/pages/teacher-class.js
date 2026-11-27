import { h, mount, icon, spinner, fmtDate, plural, pts } from "../dom.js";
import { api } from "../api.js";
import { navigate } from "../router.js";
import { toast } from "../toast.js";
import { extractFileText } from "../pdf.js";
import { dialog, confirmDialog, errorBox, field } from "../ui.js";
import { requireTeacher } from "./_auth.js";

async function copy(text, what) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copied`);
  } catch {
    toast(`Copy this: ${text}`);
  }
}

export default async function TeacherClass(ctx) {
  const user = await requireTeacher();
  if (!user) return h("div");
  const id = ctx.params.id;
  let data;
  try {
    data = await api.get(`/api/teacher/classes/${id}`);
  } catch (e) {
    return h("div", { class: "card stack" }, h("p", { class: "form-error" }, e.message), h("a", { class: "btn btn-primary", href: "/teacher" }, "Back to classes"));
  }
  document.title = `${data.cls.name} | StudyBuddy`;
  let tab = ctx.query.get("tab") || "homework";
  const root = h("div", { class: "stack-lg" });

  async function reload() {
    data = await api.get(`/api/teacher/classes/${id}`);
    draw();
  }

  function addCurriculum() {
    const title = h("input", { class: "input", id: "ct", maxlength: 120, placeholder: "Unit 3: Photosynthesis" });
    const content = h("textarea", { class: "textarea", rows: 8, id: "cc", placeholder: "Paste your curriculum, unit plan, standards or reading here…" });
    const file = h("input", { type: "file", accept: ".pdf,.txt,.md,application/pdf,text/plain", class: "file-input", "aria-label": "Upload a PDF or text file" });
    const status = h("span", { class: "muted small" });
    const err = errorBox();
    file.addEventListener("change", async () => {
      const f = file.files[0];
      if (!f) return;
      status.replaceChildren(spinner(), " Reading file…");
      try {
        content.value = await extractFileText(f);
        if (!title.value) title.value = f.name.replace(/\.[^.]+$/, "");
        status.textContent = `Loaded ${content.value.length.toLocaleString()} characters from ${f.name}`;
      } catch (e) {
        status.textContent = "";
        err.show(e.message);
      }
    });
    dialog({
      title: "Add curriculum",
      body: h("div", { class: "stack" }, err, field("Title", title), field("Text", content, "The AI follows this when it writes homework for this class."), h("div", { class: "row" }, h("label", { class: "btn btn-outline btn-sm" }, icon("upload"), "Upload PDF or text", file), status)),
      actions: (close) => [
        h("button", { class: "btn btn-ghost", type: "button", onclick: () => close("cancel") }, "Cancel"),
        h("button", { class: "btn btn-primary", type: "button", onclick: async (e) => {
          err.clear();
          e.target.disabled = true;
          try {
            await api.post(`/api/teacher/classes/${id}/curricula`, { title: title.value, content: content.value });
            close("ok");
            toast("Curriculum added");
            tab = "curriculum";
            reload();
          } catch (e2) {
            err.show(e2.message);
            e.target.disabled = false;
          }
        } }, "Add curriculum"),
      ],
    });
  }

  function draw() {
    const { cls } = data;
    const tabs = [["homework", `Homework (${data.homework.length})`], ["curriculum", `Curriculum (${data.curricula.length})`], ["students", `Students (${data.students.length})`]];
    const publishedCount = data.homework.filter((x) => x.status === "published").length;

    const homework = h("div", { class: "stack" },
      h("div", { class: "row row-between" }, h("p", { class: "muted" }, "Talk to the AI about what you want, edit the questions, then publish to the class."), h("a", { class: "btn btn-primary", href: `/teacher/classes/${id}/homework/new` }, icon("plus"), "New homework")),
      data.homework.length === 0
        ? h("div", { class: "card center stack empty" }, icon("pencil", 30), h("h3", { class: "card-title" }, "No homework yet"), h("p", { class: "muted" }, "Describe what you want in plain words and the AI drafts it from your curriculum or textbook."))
        : data.homework.map((hw) =>
            h("article", { class: "card hw-card" },
              h("div", { class: "grow stack" }, h("div", { class: "row" }, h("h3", { class: "card-title" }, hw.title), h("span", { class: `chip ${hw.status === "published" ? "chip-ok" : "chip-draft"}` }, hw.status === "published" ? "Published" : "Draft")),
                h("p", { class: "muted small" }, [plural(hw.questionCount, "question"), pts(hw.totalPoints), hw.dueAt && `Due ${fmtDate(hw.dueAt)}`].filter(Boolean).join(" · ")),
                hw.status === "published" && h("div", { class: "row" }, h("span", { class: "chip" }, icon("check", 14), `${hw.completed} of ${data.students.length} finished`), hw.avgPercent !== null && h("span", { class: "chip chip-mark" }, icon("chart-column", 14), `${hw.avgPercent}% average`))),
              h("div", { class: "row" }, hw.status === "published" && h("a", { class: "btn btn-primary btn-sm", href: `/teacher/classes/${id}/results/${hw.id}` }, icon("chart-column"), "Results"), h("a", { class: "btn btn-outline btn-sm", href: `/teacher/classes/${id}/homework/${hw.id}` }, icon("pencil"), "Edit"), h("button", { class: "btn btn-ghost btn-sm", type: "button", "aria-label": `Delete ${hw.title}`, onclick: async () => {
                if (!(await confirmDialog({ title: "Delete this homework?", message: hw.completed ? "Student results for it will be deleted too." : "This can't be undone.", confirmLabel: "Delete", danger: true }))) return;
                await api.del(`/api/teacher/homework/${hw.id}`);
                toast("Homework deleted");
                reload();
              } }, icon("trash-2")))
            )
          )
    );

    const curriculum = h("div", { class: "stack" },
      h("div", { class: "row row-between" }, h("p", { class: "muted" }, "Upload what the AI should follow. Students in this class can also study it."), h("button", { class: "btn btn-primary", type: "button", onclick: addCurriculum }, icon("plus"), "Add curriculum")),
      data.curricula.length === 0
        ? h("div", { class: "card center stack empty" }, icon("book-open", 30), h("h3", { class: "card-title" }, "No curriculum yet"), h("p", { class: "muted" }, "Paste or upload a unit plan, standards, or reading list."))
        : data.curricula.map((c) => h("article", { class: "card hw-card" }, h("div", { class: "grow" }, h("h3", { class: "card-title" }, c.title), h("p", { class: "muted small" }, `${c.chars.toLocaleString()} characters · added ${fmtDate(c.createdAt)}`)), h("button", { class: "btn btn-ghost btn-sm", type: "button", "aria-label": `Delete ${c.title}`, onclick: async () => {
            if (!(await confirmDialog({ title: "Remove this curriculum?", message: "Homework already written from it stays as it is.", confirmLabel: "Remove", danger: true }))) return;
            await api.del(`/api/teacher/curricula/${c.id}`);
            reload();
          } }, icon("trash-2"))))
    );

    const students = data.students.length === 0
      ? h("div", { class: "card center stack empty" }, icon("users", 30), h("h3", { class: "card-title" }, "No students yet"), h("p", { class: "muted" }, "Share the join code. Students enter it with their first name."), h("div", { class: "code-pill big" }, h("b", null, cls.joinCode)))
      : h("div", { class: "card table-card" }, h("table", { class: "table" }, h("thead", null, h("tr", null, h("th", null, "Student"), h("th", null, "Joined"), h("th", { class: "num-col" }, "Homework done"))), h("tbody", null, data.students.map((s) => h("tr", null, h("td", null, s.firstName), h("td", { class: "muted" }, fmtDate(s.createdAt)), h("td", { class: "num-col" }, `${s.completed} of ${publishedCount}`))))));

    mount(
      root,
      h("a", { class: "btn btn-ghost btn-sm back", href: "/teacher" }, icon("arrow-left"), "All classes"),
      h("div", { class: "class-head card" },
        h("div", { class: "grow stack" }, h("div", { class: "row" }, h("h1", { class: "mode-title" }, cls.name), cls.subject && h("span", { class: "chip" }, cls.subject)), h("p", { class: "muted" }, "Share this code with your students:"), h("div", { class: "row" }, h("div", { class: "code-pill big" }, h("b", null, cls.joinCode)), h("button", { class: "btn btn-outline btn-sm", type: "button", onclick: () => copy(cls.joinCode, "Code") }, icon("copy"), "Copy code"), h("button", { class: "btn btn-outline btn-sm", type: "button", onclick: () => copy(`${location.origin}/join?code=${cls.joinCode}`, "Join link") }, icon("link"), "Copy join link"))),
        h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: async () => {
          if (!(await confirmDialog({ title: `Delete ${cls.name}?`, message: "Its students, curriculum, homework and results will be deleted. This can't be undone.", confirmLabel: "Delete class", danger: true }))) return;
          await api.del(`/api/teacher/classes/${id}`);
          toast("Class deleted");
          navigate("/teacher");
        } }, icon("trash-2"), "Delete class")),
      h("div", { class: "tabs", role: "tablist" }, tabs.map(([k, label]) => h("button", { class: "tab", role: "tab", type: "button", "aria-selected": tab === k, onclick: () => ((tab = k), draw()) }, label))),
      tab === "homework" ? homework : tab === "curriculum" ? curriculum : students
    );
  }
  draw();
  return root;
}
