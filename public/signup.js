// signup form → POST /api/subscribe, swap in the .done state on success
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
