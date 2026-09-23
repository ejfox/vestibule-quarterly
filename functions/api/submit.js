// POST /api/submit — a magazine submission. Stores a row in D1 (binding: vestibule).
// Accepts JSON or form-encoded. Returns { ok: true } on success.

export async function onRequestPost({ request, env }) {
  try {
    const data = await readBody(request);

    const name  = (data.name  || '').toString().trim().slice(0, 200);
    const email = (data.email || '').toString().trim().slice(0, 320);
    const kind  = (data.kind  || '').toString().trim().slice(0, 80);
    const title = (data.title || '').toString().trim().slice(0, 300);
    const link  = (data.link  || '').toString().trim().slice(0, 2000);
    const pitch = (data.pitch || '').toString().trim().slice(0, 20000);

    if (!name || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return json({ ok: false, error: 'Name and a valid email are required.' }, 400);
    }

    await env.vestibule
      .prepare(
        'INSERT INTO submissions (name, email, kind, title, link, pitch) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .bind(name, email, kind, title, link, pitch)
      .run();

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: 'Something went wrong on our end.' }, 500);
  }
}

// GET is a friendly no-op so the route isn't a 404 if someone visits it.
export const onRequestGet = () => json({ ok: true, hint: 'POST submissions here.' });

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
