/* =========================================================
   C4 Capstone — UI glue
   - Live EST clock
   - Project list hover → meta rail tags/index update
   - Header scrolled state
   - Smooth anchor scroll with offset for fixed header
   ========================================================= */

(function () {
  /* ---------- Live clock (Toronto / EST) ---------- */
  const clock = document.getElementById("clock");
  function updateClock() {
    if (!clock) return;
    const time = new Date().toLocaleTimeString("en-CA", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "America/Toronto",
    });
    // Detect EST vs EDT
    const tzAbbrev = new Date()
      .toLocaleTimeString("en-US", { timeZone: "America/Toronto", timeZoneName: "short" })
      .split(" ").pop();
    clock.textContent = `${tzAbbrev} ${time}`;
  }
  updateClock();
  setInterval(updateClock, 15000);

  /* ---------- Project list → meta rail sync ---------- */
  const links = document.querySelectorAll(".proj-link");
  const metaTags = document.getElementById("meta-tags");
  const metaIndex = document.getElementById("meta-index");

  function setActive(link) {
    if (!link) return;
    links.forEach((l) => l.classList.remove("active"));
    link.classList.add("active");
    if (metaTags) metaTags.textContent = link.dataset.tags || "";
    if (metaIndex) metaIndex.textContent = link.dataset.index || "";
  }

  links.forEach((link) => {
    link.addEventListener("mouseenter", () => setActive(link));
    link.addEventListener("focus", () => setActive(link));
  });

  /* ---------- Header scrolled state ---------- */
  const header = document.querySelector(".site-header");
  function onScroll() {
    if (!header) return;
    if (window.scrollY > 40) header.classList.add("scrolled");
    else header.classList.remove("scrolled");
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- Smooth anchor offset ---------- */
  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", (e) => {
      const href = link.getAttribute("href");
      if (!href || href === "#") return;
      const target = document.querySelector(href);
      if (!target) return;
      e.preventDefault();
      const top = target.getBoundingClientRect().top + window.scrollY - 80;
      window.scrollTo({ top, behavior: "smooth" });
    });
  });
})();
