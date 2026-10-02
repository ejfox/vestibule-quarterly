// The Vestibule hotline. Twilio answers the phone, this worker does the rest.
//
// twilio webhooks (POST, must carry our AccountSid):
//   /voice        greeting (dial ARCHIVE_CODE during it to hear the archive) → record
//   /menu         digits pressed during the greeting
//   /archive      plays approved messages, newest first (1 = skip, * = leave your own)
//   /done         thank the caller, hang up
//   /recording    recordingStatusCallback → queue; queue() copies the mp3 to R2,
//                 transcribes, emails, posts to discord, logs it in D1
// for people:
//   GET  /approve?sid&sig   editor page from the email: listen, add to / pull from the archive
//   GET  /audio/<sid>.mp3   approved messages only (or with a valid sig), straight from R2
//
// Nobody else can make us send mail: we only mail a recording we've just
// downloaded from *our* twilio account with our api key, by sid, once. A forged
// callback names a recording that doesn't exist and gets dropped. (We hold a
// revocable api key, not the account auth token, so no X-Twilio-Signature.)
// Secrets: TWILIO_ACCOUNT_SID, TWILIO_API_KEY, TWILIO_API_SECRET, APPROVE_SECRET,
// DISCORD_WEBHOOK_URL (optional — no secret, no discord post).

import { EmailMessage } from 'cloudflare:email';

const MAX_SECONDS = 300;
// twilio's default hangs up after 5s of quiet, which cut off people gathering their thoughts.
const SILENCE_SECONDS = 30;
const SID = /^RE[0-9a-f]{32}$/;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname === '/') return new Response('the vestibule hotline is listening.\n');
    if (req.method === 'GET' && url.pathname.startsWith('/audio/')) return audio(url, env);
    if (url.pathname === '/approve') return approve(req, url, env);
    if (req.method !== 'POST') return new Response('not found', { status: 404 });

    const params = Object.fromEntries(await req.formData().catch(() => []));
    if (params.AccountSid !== env.TWILIO_ACCOUNT_SID) return new Response('forbidden', { status: 403 });

    switch (url.pathname) {
      case '/voice': return voice(url, params, env);
      case '/menu': return params.Digits === env.ARCHIVE_CODE ? archive(url, params, env, 0) : twiml(record(url, params));
      case '/archive': return archive(url, params, env, Number(url.searchParams.get('i')) || 0);
      case '/archive-key':
        if (params.Digits === '*') return twiml(`<Say voice="${env.VOICE}">Your turn.</Say>${record(url, params)}`);
        return archive(url, params, env, (Number(url.searchParams.get('i')) || 0) + 1);
      case '/done': return twiml(`<Say voice="${env.VOICE}">${esc(env.GOODBYE)}</Say><Hangup/>`);
      case '/recording':
        // twilio wants a fast 2xx; the slow work (download, whisper, mail) runs in queue().
        await env.JOBS.send({ url: url.href, params });
        return new Response(null, { status: 204 });
    }
    return new Response('not found', { status: 404 });
  },

  async queue(batch, env) {
    for (const msg of batch.messages) {
      // the dead-letter queue: every retry failed. say so instead of losing it quietly.
      if (batch.queue.endsWith('-dlq')) {
        await alert(msg.body, env).catch((e) => console.error('alert failed', e));
        msg.ack();
        continue;
      }
      try {
        await deliver(new URL(msg.body.url), msg.body.params, env);
        msg.ack();
      } catch (e) {
        console.error('deliver failed', e);
        msg.retry({ delaySeconds: 60 });
      }
    }
  },
};

function voice(url, p, env) {
  const greeting = env.GREETING_URL
    ? `<Play>${esc(env.GREETING_URL)}</Play>`
    : `<Say voice="${env.VOICE}">${esc(env.GREETING)}</Say>`;
  // the greeting listens for the archive code; any other key skips straight to the beep.
  // no input → falls through to <Record> after the gather's 2s timeout.
  return twiml(`<Gather input="dtmf" numDigits="${env.ARCHIVE_CODE.length}" timeout="2" finishOnKey=""
    action="${esc(new URL('/menu', url).href)}" actionOnEmptyResult="false">${greeting}</Gather>
  ${record(url, p)}`);
}

function record(url, p) {
  // the recording callback doesn't carry caller info, so we hand it along in the url.
  const cb = new URL('/recording', url);
  cb.search = new URLSearchParams({ from: p.From || '', where: [p.FromCity, p.FromState, p.FromCountry].filter(Boolean).join(', ') });
  return `<Record maxLength="${MAX_SECONDS}" timeout="${SILENCE_SECONDS}" playBeep="true" finishOnKey="#" trim="trim-silence"
    action="${esc(new URL('/done', url).href)}"
    recordingStatusCallback="${esc(cb.href)}" recordingStatusCallbackEvent="completed"/>`;
}

// one approved message per request; twilio walks the list via <Redirect>.
async function archive(url, p, env, i) {
  const { results } = await env.DB.prepare('SELECT recording_sid FROM voicemails WHERE published = 1 ORDER BY id DESC').all();
  const say = (s) => `<Say voice="${env.VOICE}">${esc(s)}</Say>`;
  if (!results.length) return twiml(say('The archive is empty. For now. Leave the first one.') + record(url, p));
  if (i >= results.length) return twiml(say("That's the whole archive. Your turn.") + record(url, p));

  const at = (path) => { const u = new URL(path, url); u.search = `?i=${i}`; return esc(u.href); };
  const intro = i === 0 ? `Welcome to the archive. ${results.length} message${results.length > 1 ? 's' : ''}. Press 1 to skip ahead, or star to leave your own. ` : '';
  return twiml(`<Gather input="dtmf" numDigits="1" timeout="1" finishOnKey="" action="${at('/archive-key')}" actionOnEmptyResult="false">
    ${say(`${intro}Message ${i + 1}.`)}<Play>${esc(new URL(`/audio/${results[i].recording_sid}.mp3`, url).href)}</Play>
  </Gather><Redirect method="POST">${esc(new URL(`/archive?i=${i + 1}`, url).href)}</Redirect>`);
}

async function audio(url, env) {
  const sid = url.pathname.slice('/audio/'.length).replace(/\.mp3$/, '');
  if (!SID.test(sid)) return new Response('not found', { status: 404 });
  // public only once an editor approved it; the approve page passes its sig to preview.
  const ok = (await sigOk(sid, url.searchParams.get('sig'), env)) ||
    (await env.DB.prepare('SELECT 1 FROM voicemails WHERE recording_sid = ? AND published = 1').bind(sid).first());
  const obj = ok && (await env.ARCHIVE.get(`${sid}.mp3`));
  if (!obj) return new Response('not found', { status: 404 });
  return new Response(obj.body, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, max-age=60' } });
}

async function approve(req, url, env) {
  const form = req.method === 'POST' ? Object.fromEntries(await req.formData().catch(() => [])) : {};
  const sid = form.sid || url.searchParams.get('sid') || '';
  const sig = form.sig || url.searchParams.get('sig') || '';
  if (!SID.test(sid) || !(await sigOk(sid, sig, env))) return new Response('bad link', { status: 403 });
  // messages from before the R2 copy existed can't be played on the phone, so they can't be published.
  const playable = !!(await env.ARCHIVE.head(`${sid}.mp3`));

  // a POST, not a GET, flips it: mail scanners prefetch links and shouldn't publish anything.
  if (req.method === 'POST') {
    const publish = form.publish === '1' && playable ? 1 : 0;
    await env.DB.prepare('UPDATE voicemails SET published = ? WHERE recording_sid = ?').bind(publish, sid).run();
    return Response.redirect(`${url.origin}/approve?sid=${sid}&sig=${sig}`, 303);
  }
  const row = await env.DB.prepare('SELECT * FROM voicemails WHERE recording_sid = ?').bind(sid).first();
  if (!row) return new Response('not found', { status: 404 });
  return new Response(page(row, sig, playable), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

async function deliver(url, p, env) {
  const seconds = Number(p.RecordingDuration) || 0;
  if (p.RecordingStatus !== 'completed' || seconds < 1) return; // hung up before saying anything
  // queue retries and twilio re-sends shouldn't mail the same message twice.
  if (await env.DB.prepare('SELECT 1 FROM voicemails WHERE recording_sid = ?').bind(p.RecordingSid).first()) return;

  // build the url ourselves from the sid, so we only ever fetch our own recordings.
  if (!SID.test(p.RecordingSid || '') && !env.DEV_ANY_RECORDING_HOST) return;
  const rec = env.DEV_ANY_RECORDING_HOST
    ? `${p.RecordingUrl}.mp3`
    : `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Recordings/${p.RecordingSid}.mp3`;
  const res = await fetch(rec, { headers: { Authorization: `Basic ${btoa(`${env.TWILIO_API_KEY}:${env.TWILIO_API_SECRET}`)}` } });
  if (res.status === 404) return console.warn(`no such recording ${p.RecordingSid}, dropping`);
  if (!res.ok) throw new Error(`recording fetch ${res.status}`);
  const audio = new Uint8Array(await res.arrayBuffer());
  // our own copy, so the audio outlives the twilio account.
  await env.ARCHIVE.put(`${p.RecordingSid}.mp3`, audio, { httpMetadata: { contentType: 'audio/mpeg' } });

  const call = {
    sid: p.RecordingSid,
    from: url.searchParams.get('from') || 'unknown',
    where: url.searchParams.get('where') || '',
    seconds,
    when: new Date(),
    transcript: await transcribe(audio, env),
    approve: `${url.origin}/approve?sid=${p.RecordingSid}&sig=${await sign(p.RecordingSid, env)}`,
  };
  const filename = `vestibule-hotline-${call.when.toISOString().slice(0, 16).replace(/[:T]/g, '-')}.mp3`;

  // no email at all → throw, so the queue retries. discord is a bonus; it only logs.
  await email(call, audio, filename, env);
  await discord(call, audio, filename, env).catch((e) => console.error(e));

  await env.DB.prepare(
    'INSERT OR IGNORE INTO voicemails (recording_sid, call_sid, caller, location, seconds, transcript, recording_url) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(call.sid, p.CallSid || null, call.from, call.where, seconds, call.transcript, p.RecordingUrl).run();
}

async function transcribe(audio, env) {
  try {
    // vad_filter skips silence, which whisper otherwise "hears" as "thank you."
    const out = await env.AI.run('@cf/openai/whisper-large-v3-turbo', { audio: base64(audio), vad_filter: true });
    return (out.text || '').trim();
  } catch (e) {
    console.error('whisper failed', e);
    return '';
  }
}

async function email(call, audio, filename, env) {
  const mins = `${Math.floor(call.seconds / 60)}:${String(call.seconds % 60).padStart(2, '0')}`;
  const subject = `☎ hotline: ${mins} from ${call.from}${call.where ? ` (${call.where})` : ''}`;
  const text = [
    `New message on the Vestibule hotline.`,
    ``,
    `From: ${call.from}${call.where ? ` — ${call.where}` : ''}`,
    `Length: ${mins}`,
    `When: ${call.when.toUTCString()}`,
    ``,
    call.transcript ? `Transcript (machine, rough):\n${call.transcript}` : '(no transcript)',
    ``,
    `The audio is attached.`,
    ``,
    `Put it in the phone archive (or don't): ${call.approve}`,
  ].join('\n');
  const html = `
    <div style="font:16px/1.5 Georgia,serif;max-width:520px">
      <h2 style="margin:0 0 4px">☎ The Vestibule hotline</h2>
      <p style="color:#777;margin:0 0 16px">${esc(call.from)}${call.where ? ` · ${esc(call.where)}` : ''} · ${mins}</p>
      ${call.transcript ? `<blockquote style="margin:0;padding:10px 14px;border-left:3px solid #b8860b;background:#faf6ee">${esc(call.transcript)}</blockquote>
      <p style="color:#999;font-size:13px">machine transcript, rough. the audio is attached.</p>` : '<p>(no transcript — the audio is attached.)</p>'}
      <p style="margin-top:20px"><a href="${esc(call.approve)}" style="color:#b8860b">Put it in the phone archive →</a></p>
    </div>`;

  const from = env.FROM_ADDRESS;
  const recipients = env.HOTLINE_EMAILS.split(',').map((s) => s.trim()).filter(Boolean);
  // one send per recipient: email routing only delivers to verified addresses,
  // so an unverified one shouldn't block the others.
  const sent = await Promise.allSettled(recipients.map((to) =>
    env.EMAIL.send(new EmailMessage(from, to, mime({ from: `The Vestibule Hotline <${from}>`, to, subject, text, html, audio, filename })))
  ));
  sent.forEach((r, i) => r.status === 'rejected' && console.error(`mail to ${recipients[i]} failed`, r.reason));
  if (!sent.some((r) => r.status === 'fulfilled')) throw new Error('no email went out');
}

async function discord(call, audio, filename, env) {
  if (!env.DISCORD_WEBHOOK_URL) return;
  // discord is semi-public, so only the last four digits of the caller.
  const who = call.from.replace(/.(?=.{4})/g, '•');
  const body = new FormData();
  body.append('payload_json', JSON.stringify({
    username: 'The Vestibule Hotline',
    content: `☎ **new message** from ${who}${call.where ? ` (${call.where})` : ''}, ${call.seconds}s` +
      (call.transcript ? `\n>>> ${call.transcript.slice(0, 1800)}` : ''),
    allowed_mentions: { parse: [] },
  }));
  body.append('files[0]', new Blob([audio], { type: 'audio/mpeg' }), filename);
  const res = await fetch(env.DISCORD_WEBHOOK_URL, { method: 'POST', body });
  if (!res.ok) throw new Error(`discord ${res.status}: ${await res.text()}`);
}

// a voicemail that failed every retry. the audio is still on twilio (and maybe R2).
async function alert({ url, params: p }, env) {
  const from = new URL(url).searchParams.get('from') || 'unknown';
  const text = [
    `A hotline message from ${from} failed to go through after every retry.`,
    ``,
    `Recording: ${p.RecordingSid} (${p.RecordingDuration}s)`,
    `Find it in Twilio → Monitor → Call recordings, or in R2 bucket vestibule-hotline.`,
    `Logs: wrangler tail vestibule-hotline`,
  ].join('\n');
  const recipients = env.HOTLINE_EMAILS.split(',').map((s) => s.trim()).filter(Boolean);
  await Promise.allSettled(recipients.map((to) => env.EMAIL.send(new EmailMessage(env.FROM_ADDRESS, to,
    mime({ from: `The Vestibule Hotline <${env.FROM_ADDRESS}>`, to, subject: `⚠ hotline: a message from ${from} didn't make it`, text, html: `<pre>${esc(text)}</pre>` })))));
}

// hmac-sha256 of the recording sid; the approve link and audio previews carry it.
async function sign(sid, env) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(env.APPROVE_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(sid)));
  return [...mac.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sigOk(sid, sig, env) {
  const enc = new TextEncoder();
  const got = enc.encode(sig || '');
  const want = enc.encode(await sign(sid, env));
  return got.length === want.length && crypto.subtle.timingSafeEqual(got, want);
}

function page(row, sig, playable) {
  const on = row.published === 1;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hotline message · Vestibule Quarterly</title><meta name="robots" content="noindex">
<style>
  :root { --paper:#f4efe4; --ink:#1d1a16; --muted:#6e665a; --amber:#b8860b; }
  @media (prefers-color-scheme: dark) { :root { --paper:#16130f; --ink:#ece4d4; --muted:#9a907f; --amber:#e0a93a; } }
  body { margin:0; background:var(--paper); color:var(--ink); font:17px/1.55 Georgia,serif; }
  main { max-width:34rem; margin:0 auto; padding:2.5rem 16px 4rem; }
  .k { font:600 0.72rem/1 ui-monospace,monospace; letter-spacing:.12em; text-transform:uppercase; color:var(--muted); }
  h1 { font-size:1.6rem; margin:.4rem 0 1.25rem; }
  blockquote { margin:1.25rem 0; padding:.75rem 1rem; border-left:3px solid var(--amber); font-style:italic; }
  audio { width:100%; margin:.5rem 0 1.5rem; }
  .st { margin:0 0 1rem; } .st b { color:var(--amber); }
  button { font:inherit; font-size:1rem; padding:.7rem 1.1rem; border:2px solid var(--ink); background:${on ? 'transparent' : 'var(--ink)'};
    color:${on ? 'var(--ink)' : 'var(--paper)'}; cursor:pointer; }
</style></head><body><main>
  <div class="k">☎ The Vestibule hotline</div>
  <h1>${esc(row.location || 'somewhere')} · ${row.seconds}s</h1>
  <div class="k">${esc(row.created)} UTC · ${esc(row.caller.replace(/.(?=.{4})/g, '•'))}</div>
  <blockquote>${row.transcript ? esc(row.transcript) : 'no words detected'}</blockquote>
  ${playable ? `<audio controls preload="none" src="/audio/${row.recording_sid}.mp3?sig=${sig}"></audio>` : ''}
  <p class="st">${on ? '<b>In the phone archive.</b> Callers who dial the code hear it.' : 'Not in the phone archive. Only the editors have heard it.'}</p>
  ${!playable ? '<p class="st">This one came in before we kept our own copy of the audio, so it can’t go in the phone archive. The mp3 is attached to its email.</p>' : `<form method="post">
    <input type="hidden" name="sid" value="${row.recording_sid}"><input type="hidden" name="sig" value="${sig}">
    <input type="hidden" name="publish" value="${on ? 0 : 1}">
    <button>${on ? 'Pull it from the archive' : 'Put it in the phone archive'}</button>
  </form>`}
</main></body></html>`;
}

const twiml = (body) =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<Response>${body}</Response>`, { headers: { 'Content-Type': 'text/xml' } });

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

// chunked, because spreading a whole mp3 into fromCharCode blows the stack.
function base64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// multipart/mixed: a text+html body and (usually) the mp3. email routing sends raw MIME.
function mime({ from, to, subject, text, html, audio, filename }) {
  const attach = audio ? [
    `--MIXED`,
    `Content-Type: audio/mpeg; name="${filename}"`,
    `Content-Disposition: attachment; filename="${filename}"`,
    'Content-Transfer-Encoding: base64',
    '',
    base64(audio).match(/.{1,76}/g).join('\r\n'),
  ] : [];
  const b64 = (s) => base64(new TextEncoder().encode(s));
  const wrap = (s) => s.match(/.{1,76}/g).join('\r\n');
  const mixed = `vq-${crypto.randomUUID()}`;
  const alt = `vq-${crypto.randomUUID()}`;
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${b64(subject)}?=`,
    `Message-ID: <${crypto.randomUUID()}@vestibulequarterly.com>`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    '',
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    '',
    `--${alt}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(b64(text)),
    `--${alt}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(b64(html)),
    `--${alt}--`,
    ...attach.map((l) => l.replace('MIXED', mixed)),
    `--${mixed}--`,
    '',
  ].join('\r\n');
}
