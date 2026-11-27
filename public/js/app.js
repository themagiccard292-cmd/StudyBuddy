import { h } from "./dom.js";
import { initTheme } from "./theme.js";
import { route, startRouter } from "./router.js";
import { createHeader } from "./ui.js";
import { api } from "./api.js";

initTheme();

const header = createHeader();
const view = h("main", { id: "view", class: "view", tabindex: "-1" });
document.getElementById("app").append(h("div", { class: "shell" }, header.el, view));

const page = (path) => (ctx) => import(path).then((m) => m.default(ctx));
const study = { nav: true };
const teacher = { area: "teacher" };

route("/", page("./pages/home.js"), {});
route("/quiz", page("./pages/quiz.js"), study);
route("/explain", page("./pages/explain.js"), study);
route("/cards", page("./pages/cards.js"), study);
route("/practice", page("./pages/practice.js"), study);
route("/test", page("./pages/test.js"), study);
route("/chat", page("./pages/chat.js"), study);
route("/weak-spots", page("./pages/weak.js"), study);
route("/join", page("./pages/join.js"), {});
route("/class", page("./pages/class.js"), {});
route("/class/homework/:id", page("./pages/homework.js"), {});
route("/login", page("./pages/login.js"), teacher);
route("/teacher", page("./pages/teacher-home.js"), teacher);
route("/teacher/classes/:id", page("./pages/teacher-class.js"), teacher);
route("/teacher/classes/:id/homework/:hid", page("./pages/teacher-builder.js"), teacher);
route("/teacher/classes/:id/results/:hid", page("./pages/teacher-results.js"), teacher);
route("/404", page("./pages/not-found.js"), {});

// Header shows the teacher's name on teacher pages.
api.get("/api/auth/me").then((r) => header.setTeacher(r.user)).catch(() => {});
window.__setTeacher = header.setTeacher;

startRouter(view, header.update);
