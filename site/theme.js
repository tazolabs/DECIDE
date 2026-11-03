"use strict";

// Run in the head before CSS so a saved/system dark theme is applied before paint.
(() => {
  const storageKey = "decide-theme";
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  let preference = null;
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === "light" || saved === "dark") preference = saved;
  } catch { /* Theme switching still works when browser storage is unavailable. */ }

  function apply() {
    const theme = preference || (system.matches ? "dark" : "light");
    document.documentElement.dataset.theme = theme;
    const color = document.querySelector('meta[name="theme-color"]');
    if (color) color.content = theme === "dark" ? "#061214" : "#f6f9f9";
    for (const button of document.querySelectorAll("[data-theme-toggle]")) {
      const label = `Switch to ${theme === "dark" ? "light" : "dark"} mode`;
      button.setAttribute("aria-label", label);
      button.title = label;
    }
  }

  apply();
  system.addEventListener("change", () => { if (!preference) apply(); });
  window.addEventListener("storage", (event) => {
    if (event.key !== storageKey && event.key !== null) return;
    preference = event.newValue === "light" || event.newValue === "dark" ? event.newValue : null;
    apply();
  });
  document.addEventListener("DOMContentLoaded", () => {
    for (const button of document.querySelectorAll("[data-theme-toggle]")) {
      button.hidden = false;
      button.addEventListener("click", () => {
        preference = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
        try { localStorage.setItem(storageKey, preference); } catch { /* Session-only preference. */ }
        apply();
      });
    }
    apply();
  });
})();
