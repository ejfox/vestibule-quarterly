// submissions form → POST /api/submit, hide form and show #thanks on success
(() => {
  const form = document.getElementById('subform');
  if (!form) return;
  const thanks = document.getElementById('thanks');
  const note = form.querySelector('[data-note]');
  const button = form.querySelector('button.submit');

  // "respond to the chain" → preselect Chain, say which one in the pitch
  document.querySelectorAll('[data-chain]').forEach((link) => {
    link.addEventListener('click', () => {
      const kind = form.querySelector('#kind');
      const opt = kind && [...kind.options].find((o) => o.text.startsWith('Chain'));
      if (opt) kind.value = opt.value;
      const pitch = form.querySelector('#pitch');
      if (pitch && !pitch.value) pitch.value = 'Responding to open chain № 001.\n\n';
    });
  });

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
