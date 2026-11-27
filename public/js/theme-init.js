// Runs before first paint so there's no flash: dark by default, remembers the visitor's choice.
(function () {
  var mode = "dark";
  try { mode = localStorage.getItem("studybuddy:theme") || "dark"; } catch (e) {}
  var theme = mode === "auto"
    ? (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
    : mode;
  document.documentElement.setAttribute("data-theme", theme === "light" ? "light" : "dark");
})();
