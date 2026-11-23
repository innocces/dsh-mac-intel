/**
 * Keep the numbered sidebar steps synchronized with the section currently in view.
 *
 * The native hash links still perform the actual scrolling. This module owns only
 * the visual state so a click is highlighted immediately and manual scrolling
 * keeps the same invariant.
 */
(() => {
  const navLinks = Array.from(document.querySelectorAll(".side-nav .nav-item"));
  const sections = navLinks
    .map((link) => document.getElementById(link.hash.slice(1)))
    .filter((section) => section instanceof HTMLElement);
  let scheduled = false;

  /** @param {string} sectionId */
  function setActive(sectionId) {
    for (const link of navLinks) {
      const active = link.hash === `#${sectionId}`;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    }
  }

  /** Select the last section whose heading has crossed the reading marker. */
  function syncFromScroll() {
    scheduled = false;
    if (sections.length === 0) return;

    const marker = globalThis.scrollY + Math.min(180, globalThis.innerHeight * 0.28);
    let active = sections[0];
    for (const section of sections) {
      if (section.offsetTop <= marker) active = section;
    }

    setActive(active.id);
  }

  function scheduleSync() {
    if (scheduled) return;
    scheduled = true;
    globalThis.requestAnimationFrame(syncFromScroll);
  }

  for (const link of navLinks) {
    link.addEventListener("click", () => {
      setActive(link.hash.slice(1));
      // Re-evaluate after native smooth scrolling has settled.
      globalThis.setTimeout(scheduleSync, 420);
    });
  }

  globalThis.addEventListener("scroll", scheduleSync, { passive: true });
  globalThis.addEventListener("resize", scheduleSync);
  globalThis.addEventListener("hashchange", scheduleSync);

  const initialId = globalThis.location.hash.slice(1);
  setActive(
    sections.some((section) => section.id === initialId) ? initialId : sections[0]?.id ?? "",
  );
  scheduleSync();
})();
