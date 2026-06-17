/* =========================================================
   C4 — portfolio page behaviour.

   Page transitions are handled natively by the CSS View
   Transitions API (see pages.css: @view-transition) — no JS.

   This file adds accordion behaviour to the nav dropdown pills
   (PORTFOLIO / TEAMS): opening one closes the others, and a
   click outside (or Escape) closes them all.
   ========================================================= */
(() => {
  const navDetails = () => document.querySelectorAll("details.nav-details");

  // Opening one dropdown closes the rest. `toggle` doesn't bubble, so listen
  // on the capture phase (capture still reaches non-bubbling events).
  document.addEventListener(
    "toggle",
    (e) => {
      const d = e.target;
      if (d.tagName !== "DETAILS" || !d.classList.contains("nav-details") || !d.open) return;
      navDetails().forEach((other) => { if (other !== d) other.open = false; });
    },
    true
  );

  // Click anywhere outside an open dropdown closes all of them.
  document.addEventListener("click", (e) => {
    if (e.target.closest && e.target.closest("details.nav-details")) return;
    navDetails().forEach((d) => { d.open = false; });
  });

  // Escape closes any open dropdown.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") navDetails().forEach((d) => { d.open = false; });
  });
})();
