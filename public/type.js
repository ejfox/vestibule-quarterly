/*
 * type.js — reveal trigger.
 *
 * The masthead is now an SVG <textPath> seal (see index.html): the wordmark
 * rides a ring and the whole thing spins via CSS. All the per-letter layout the
 * old title needed is gone. This just flips `.type-in` on once the web fonts are
 * ready so the seal, strap, and plate fade/scale in without a flash of fallback
 * metrics (which would make the SVG text reflow on the ring).
 */
(() => {
  const go = () => document.documentElement.classList.add('type-in');
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(go);
    setTimeout(go, 1500); // safety net if fonts hang
  } else {
    go();
  }
})();
