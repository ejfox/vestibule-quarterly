/*
 * type.js — living typography for the masthead.
 *
 * Fraunces is a variable font with four axes we can drive: optical size (opsz),
 * weight (wght), softness (SOFT), and wonkiness (WONK). We animate them per
 * word on slow, offset sine waves so the title is never quite the same twice —
 * it breathes, softens, and buckles. Letters are split so each can carry its
 * own delay for the intro reveal.
 *
 * Respects prefers-reduced-motion: split + reveal still happen, the perpetual
 * axis animation does not.
 */
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const words = [...document.querySelectorAll('.masthead .word')];
  if (!words.length) return;

  // Split each word into per-letter spans for the staggered reveal.
  let idx = 0;
  for (const word of words) {
    const text = word.textContent;
    word.textContent = '';
    for (const ch of text) {
      const span = document.createElement('span');
      span.className = 'ltr';
      span.textContent = ch;
      span.style.setProperty('--i', idx++);
      word.appendChild(span);
    }
  }

  // Trigger the CSS reveal once fonts are ready (avoids a flash of fallback).
  const go = () => document.documentElement.classList.add('type-in');
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(go);
    setTimeout(go, 1200); // safety net if fonts hang
  } else {
    go();
  }

  if (reduce) return;

  // Perpetual axis drift, one phase offset per word.
  const cfg = words.map((el, i) => ({ el, phase: i * 2.3 }));
  const t0 = performance.now();

  function tick(now) {
    const t = (now - t0) / 1000;
    for (const { el, phase } of cfg) {
      const wght = 380 + 320 * (0.5 + 0.5 * Math.sin(t * 0.35 + phase));
      const soft = 55  * (0.5 + 0.5 * Math.sin(t * 0.23 + phase * 1.7));
      const wonk = Math.sin(t * 0.19 + phase * 0.7) > 0.6 ? 1 : 0;
      const opsz = 80 + 64 * (0.5 + 0.5 * Math.sin(t * 0.3 + phase));
      el.style.fontVariationSettings =
        `"opsz" ${opsz.toFixed(1)}, "wght" ${wght.toFixed(0)}, "SOFT" ${soft.toFixed(1)}, "WONK" ${wonk}`;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
