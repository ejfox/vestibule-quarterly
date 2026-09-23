/*
 * type.js — living typography for the masthead.
 *
 * The title is set in a justified, edge-to-edge arrangement (see CSS): letters
 * fill the line exactly, so nothing ever overflows. To keep it alive without
 * ever reflowing (which is what caused the old shifting/clipping), we:
 *
 *   1. hold the Fraunces axes FIXED (opsz/wght/SOFT/WONK never animate → advance
 *      widths are constant → the justified spacing never recomputes), and
 *   2. animate only `transform: translateY` per letter — a slow vertical wave.
 *      Transforms are post-layout, so they move pixels without touching the box.
 *
 * The intro reveal is opacity + de-blur only (owned by CSS); transform is owned
 * here, so the two never fight. Respects prefers-reduced-motion.
 */
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const words = [...document.querySelectorAll('.masthead .word')];
  if (!words.length) return;

  // Fixed axis values per word. The outline word gets a permanent WONK for
  // character; both are metrics-stable once set.
  const AXES = (wonk) => `"opsz" 128, "wght" 560, "SOFT" 24, "WONK" ${wonk}`;

  // Split each word into per-letter spans; assign a global index for the
  // staggered reveal and a phase for the wave.
  const letters = [];
  let idx = 0;
  words.forEach((word, w) => {
    const text = word.textContent;
    word.textContent = '';
    word.style.fontVariationSettings = AXES(w % 2 === 1 ? 1 : 0);
    [...text].forEach((ch) => {
      const span = document.createElement('span');
      span.className = 'ltr';
      span.textContent = ch;
      span.style.setProperty('--i', idx);
      letters.push({ el: span, i: idx });
      idx++;
      word.appendChild(span);
    });
  });

  // Trigger the CSS reveal once fonts are ready (no flash of fallback metrics).
  const go = () => document.documentElement.classList.add('type-in');
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(go);
    setTimeout(go, 1200); // safety net
  } else {
    go();
  }

  if (reduce) return;

  // Slow vertical wave travelling through the letters. Amplitude is tiny and in
  // em, so it scales with the type and stays well inside the padded line box.
  const t0 = performance.now();
  function tick(now) {
    const t = (now - t0) / 1000;
    for (const { el, i } of letters) {
      const y = Math.sin(t * 0.6 + i * 0.5) * 0.045; // ±0.045em
      el.style.transform = `translateY(${y.toFixed(4)}em)`;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
