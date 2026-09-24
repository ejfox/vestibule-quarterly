/*
 * signup.js — the "notify me" form on the landing page.
 *
 * Posts the email as JSON to our Pages Function (functions/api/subscribe.js → D1)
 * without a page reload, then swaps the form for a confirmation line (.done).
 */
(() => {
  const form = document.querySelector('form.signup[data-ajax]');
  if (!form) return;
  const note = document.querySelector('[data-note]');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.querySelector('input[name=email]').value.trim();
    try {
      const res = await fetch(form.action, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        form.classList.add('done');
      } else if (note) {
        note.textContent = data.error || 'Something went wrong. Try again.';
      }
    } catch (_) {
      if (note) note.textContent = 'Network trouble. Try again.';
    }
  });
})();
