// POST /api/subscribe — "notify me when Issue One ships". Stores an email in D1.
// Idempotent: re-subscribing the same address is a no-op success.

export async function onRequestPost({ request, env }) {
  try {
    const data = await readBody(request);
    const email = (data.email || '').toString().trim().slice(0, 320);

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return json({ ok: false, error: 'A valid email is required.' }, 400);
    }

    await env.vestibule
      .prepare('INSERT OR IGNORE INTO signups (email) VALUES (?)')
      .bind(email)
      .run();

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: 'Something went wrong on our end.' }, 500);
  }
}

export const onRequestGet = () => json({ ok: true, hint: 'POST an email here.' });

async function readBody(request) {
  const type = request.headers.get('content-type') || '';
  if (type.includes('application/json')) return await request.json();
  const form = await request.formData();
  return Object.fromEntries(form.entries());
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
