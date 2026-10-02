// The Vestibule hotline. Twilio answers the phone, this worker does the rest.
//
//   POST /voice      twilio "a call comes in" webhook → greeting + beep + record
//   POST /done       <Record action> → thank the caller, hang up
//   POST /recording  recordingStatusCallback → queue; queue() downloads the mp3,
//                    transcribes, emails, posts to discord, logs it in D1
//
// Every request must carry ?k=WEBHOOK_KEY (it's in the webhook url we gave
// twilio), so nobody else can make us send mail. We use a revocable twilio api
// key, not the account auth token, which is why this isn't X-Twilio-Signature.
// Secrets: WEBHOOK_KEY, TWILIO_ACCOUNT_SID, TWILIO_API_KEY, TWILIO_API_SECRET,
// DISCORD_WEBHOOK_URL (optional — no secret, no discord post).

import { EmailMessage } from 'cloudflare:email';

const MAX_SECONDS = 300;

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname === '/') return new Response('the vestibule hotline is listening.\n');
    if (req.method !== 'POST') return new Response('not found', { status: 404 });

    const params = Object.fromEntries(await req.formData());
    if (!keyOk(url, env) || params.AccountSid !== env.TWILIO_ACCOUNT_SID) return new Response('forbidden', { status: 403 });

    if (url.pathname === '/voice') return voice(url, params, env);
    if (url.pathname === '/done') return twiml(`<Say voice="${env.VOICE}">${esc(env.GOODBYE)}</Say><Hangup/>`);
    if (url.pathname === '/recording') {
      // twilio wants a fast 2xx; the slow work (download, whisper, mail) runs in queue().
      await env.JOBS.send({ url: url.href, params });
      return new Response(null, { status: 204 });
    }
    return new Response('not found', { status: 404 });
  },

  async queue(batch, env) {
    for (const msg of batch.messages) {
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
  // the recording callback doesn't carry caller info, so we hand it along in the url.
  // both follow-up urls carry the key along too.
  const k = url.searchParams.get('k');
  const cb = new URL('/recording', url);
  cb.search = new URLSearchParams({ k, from: p.From || '', where: [p.FromCity, p.FromState, p.FromCountry].filter(Boolean).join(', ') });
  const done = new URL('/done', url);
  done.search = new URLSearchParams({ k });
  // a recorded greeting ends with its own beep (it trips out into it), so twilio's is off.
  const greeting = env.GREETING_URL
    ? `<Play>${esc(env.GREETING_URL)}</Play>`
    : `<Say voice="${env.VOICE}">${esc(env.GREETING)}</Say>`;
  return twiml(`${greeting}
  <Record maxLength="${MAX_SECONDS}" playBeep="${!env.GREETING_URL}" finishOnKey="#" trim="trim-silence"
    action="${esc(done.href)}"
    recordingStatusCallback="${esc(cb.href)}" recordingStatusCallbackEvent="completed"/>`);
}

async function deliver(url, p, env) {
  const seconds = Number(p.RecordingDuration) || 0;
  if (p.RecordingStatus !== 'completed' || seconds < 1) return; // hung up before saying anything
  // queue retries and twilio re-sends shouldn't mail the same message twice.
  if (await env.DB.prepare('SELECT 1 FROM voicemails WHERE recording_sid = ?').bind(p.RecordingSid).first()) return;

  // only ever fetch from twilio, with our credentials.
  const rec = new URL(`${p.RecordingUrl}.mp3`);
  if (rec.hostname !== 'api.twilio.com' && !env.DEV_ANY_RECORDING_HOST) throw new Error(`odd recording host ${rec.hostname}`);
  const res = await fetch(rec, { headers: { Authorization: `Basic ${btoa(`${env.TWILIO_API_KEY}:${env.TWILIO_API_SECRET}`)}` } });
  if (!res.ok) throw new Error(`recording fetch ${res.status}`);
  const audio = new Uint8Array(await res.arrayBuffer());

  const call = {
    sid: p.RecordingSid,
    from: url.searchParams.get('from') || 'unknown',
    where: url.searchParams.get('where') || '',
    seconds,
    when: new Date(),
    transcript: await transcribe(audio, env),
  };
  const filename = `vestibule-hotline-${call.when.toISOString().slice(0, 16).replace(/[:T]/g, '-')}.mp3`;

  // each channel fails on its own; one broken webhook shouldn't eat the mail.
  const results = await Promise.allSettled([email(call, audio, filename, env), discord(call, audio, filename, env)]);
  results.filter((r) => r.status === 'rejected').forEach((r) => console.error(r.reason));

  await env.DB.prepare(
    'INSERT OR IGNORE INTO voicemails (recording_sid, call_sid, caller, location, seconds, transcript, recording_url) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(call.sid, p.CallSid || null, call.from, call.where, seconds, call.transcript, p.RecordingUrl).run();
}

async function transcribe(audio, env) {
  try {
    const out = await env.AI.run('@cf/openai/whisper-large-v3-turbo', { audio: base64(audio) });
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
  ].join('\n');
  const html = `
    <div style="font:16px/1.5 Georgia,serif;max-width:520px">
      <h2 style="margin:0 0 4px">☎ The Vestibule hotline</h2>
      <p style="color:#777;margin:0 0 16px">${esc(call.from)}${call.where ? ` · ${esc(call.where)}` : ''} · ${mins}</p>
      ${call.transcript ? `<blockquote style="margin:0;padding:10px 14px;border-left:3px solid #b8860b;background:#faf6ee">${esc(call.transcript)}</blockquote>
      <p style="color:#999;font-size:13px">machine transcript, rough. the audio is attached.</p>` : '<p>(no transcript — the audio is attached.)</p>'}
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

function keyOk(url, env) {
  const enc = new TextEncoder();
  const got = enc.encode(url.searchParams.get('k') || '');
  const want = enc.encode(env.WEBHOOK_KEY || '');
  return want.length > 0 && got.length === want.length && crypto.subtle.timingSafeEqual(got, want);
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

// multipart/mixed: a text+html body and the mp3. email routing sends raw MIME.
function mime({ from, to, subject, text, html, audio, filename }) {
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
    `--${mixed}`,
    `Content-Type: audio/mpeg; name="${filename}"`,
    `Content-Disposition: attachment; filename="${filename}"`,
    'Content-Transfer-Encoding: base64',
    '',
    wrap(base64(audio)),
    `--${mixed}--`,
    '',
  ].join('\r\n');
}
