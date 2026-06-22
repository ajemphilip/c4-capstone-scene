/* =========================================================
   C4 — portfolio page behaviour (works in every browser).

   1. Page transition: a paper cover (body::after, styled in pages.css)
      fades the body in on load and out before any internal navigation.
      The heading is lifted above the cover, so the kicker/badge/title
      stay put while the rest of the page crosses over — the heading
      visibly persists from page to page.

   2. Nav dropdown accordion (PORTFOLIO / TEAMS): opening one closes the
      others; a click outside or Escape closes them all.
   ========================================================= */
(() => {
  const body = document.body;
  const DUR = 700;            // must match the body::after transition duration

  // --- transition: reveal on arrival, cover before leaving --------------
  const reveal = () =>
    requestAnimationFrame(() => requestAnimationFrame(() => body.classList.add("revealed")));
  if (document.readyState !== "loading") reveal();
  else document.addEventListener("DOMContentLoaded", reveal);

  // Restore cleanly from the back/forward cache.
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) { body.classList.remove("leaving"); body.classList.add("revealed"); }
  });

  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    const href = a.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("mailto:") ||
        a.target === "_blank" || a.hasAttribute("download") || /^https?:\/\//i.test(href)) return;
    e.preventDefault();
    body.classList.remove("revealed");
    body.classList.add("leaving");
    setTimeout(() => { window.location.href = href; }, DUR);
  });

  // --- nav dropdown accordion -------------------------------------------
  const navDetails = () => document.querySelectorAll("details.nav-details");
  document.addEventListener("toggle", (e) => {
    const d = e.target;
    if (d.tagName !== "DETAILS" || !d.classList.contains("nav-details") || !d.open) return;
    navDetails().forEach((o) => { if (o !== d) o.open = false; });
  }, true);
  document.addEventListener("click", (e) => {
    if (e.target.closest && e.target.closest("details.nav-details")) return;
    navDetails().forEach((d) => { d.open = false; });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") navDetails().forEach((d) => { d.open = false; });
  });
})();

/* =========================================================
   3. Staggered scroll-reveal (GSAP + ScrollTrigger).
      Content blocks fade + rise as they enter the viewport, in
      staggered batches. (GSAP works on plain HTML — Framer Motion
      would need React, which these pages don't use.) The hero
      heading is left out so the page-transition keeps it in place.
      Progressive enhancement: if GSAP fails to load or the user
      prefers reduced motion, everything just shows normally.
   ========================================================= */
(() => {
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || !window.gsap || !window.ScrollTrigger) return;

  gsap.registerPlugin(ScrollTrigger);
  const blocks = gsap.utils.toArray(
    "main > .doc-links, main > .team-photo, main > .group-head, main > .item, main > .team-grid, main > .page-nav"
  );
  if (!blocks.length) return;

  const TWEEN = { opacity: 1, y: 0, duration: 0.6, ease: "power2.out", stagger: 0.12, overwrite: true };
  gsap.set(blocks, { opacity: 0, y: 28 });   // hide immediately (the paper cover masks this)

  const vh = window.innerHeight;
  const above = [], below = [];
  // Already on screen → stagger in on load (ScrollTrigger.batch won't fire
  // onEnter for elements that start in view). Rest → reveal on scroll.
  blocks.forEach((el) => (el.getBoundingClientRect().top < vh ? above : below).push(el));
  if (above.length) gsap.to(above, { ...TWEEN, delay: 0.25 });
  if (below.length) {
    ScrollTrigger.batch(below, {
      start: "top 88%",
      onEnter: (batch) => gsap.to(batch, TWEEN),
    });
  }

  // SAFETY NET: nothing can stay stuck hidden. After 2.5s, force-reveal any
  // block that is in the viewport but still transparent (covers animation
  // hiccups, fold mis-classification, or a slow GSAP tick).
  setTimeout(() => {
    blocks.forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight && r.bottom > 0 && parseFloat(getComputedStyle(el).opacity) < 0.9) {
        gsap.set(el, { opacity: 1, y: 0 });
      }
    });
  }, 2500);

  // Print / "Save as PDF": reveal every block first so nothing is captured
  // mid-animation or still hidden (belt-and-suspenders with the @media print CSS).
  window.addEventListener("beforeprint", () => gsap.set(blocks, { opacity: 1, y: 0 }));

  window.addEventListener("load", () => ScrollTrigger.refresh());
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => ScrollTrigger.refresh());
})();
