/*
 * submit-form.js — the submissions form.
 *
 * Posts the fields as JSON to our Pages Function (functions/api/submit.js → D1)
 * without a page reload, then hides the form and reveals the thank-you note.
 */
(() => {
  const form = document.getElementById('subform');
  if (!form) return;
  const thanks = document.getElementById('thanks');
  const note = form.querySelector('[data-note]');
  const button = form.querySelector('button.submit');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const payload = {};
    new FormData(form).forEach((v, k) => { payload[k] = v; });

    if (button) { button.disabled = true; button.textContent = 'Sending…'; }
    try {
      const res = await fetch(form.action, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        form.style.display = 'none';
        thanks.classList.add('show');
        thanks.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (note) note.textContent = data.error || 'Something went wrong. Try again.';
    } catch (_) {
      if (note) note.textContent = 'Network trouble. Try again in a moment.';
    }
    // reached only on failure — re-enable the button so they can retry
    if (button) { button.disabled = false; button.textContent = 'Send submission'; }
  });
})();
