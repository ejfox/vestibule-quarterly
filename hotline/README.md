# The Vestibule hotline

Call a number, leave a message, and it shows up in our email (and optionally
Discord), with the mp3 attached and a rough Whisper transcript.

```
caller → twilio number → POST /voice      greeting, beep, <Record> (max 5 min, # to finish)
                       → POST /done       "got it, thank you", hang up
                       → POST /recording  enqueue → queue(): fetch mp3 from twilio,
                                          whisper (workers AI), email, discord, D1 log
```

One Worker (`src/index.js`), no dependencies. Lives at
https://vestibule-hotline.ejfox.workers.dev.

| Piece        | What                                                              |
| ------------ | ----------------------------------------------------------------- |
| Phone        | Twilio number, "a call comes in" webhook → `POST /voice`          |
| Auth         | every request needs `?k=WEBHOOK_KEY` + our `AccountSid`          |
| Slow work    | Queue `vestibule-hotline` (waitUntil's ~30s isn't enough)         |
| Transcript   | Workers AI `@cf/openai/whisper-large-v3-turbo`                    |
| Email        | Email Routing `send_email` from `hotline@vestibulequarterly.com`  |
| Log          | D1 `vestibule`, table `voicemails` (audio itself stays on Twilio) |

## Setup

```sh
wrangler secret put TWILIO_ACCOUNT_SID
wrangler secret put TWILIO_API_KEY         # SK… — a revocable api key ("Vestibule-API")
wrangler secret put TWILIO_API_SECRET      # its secret; downloads recordings
openssl rand -hex 24 | tee /dev/stderr | wrangler secret put WEBHOOK_KEY
wrangler secret put DISCORD_WEBHOOK_URL    # optional — unset means no discord post
wrangler deploy
```

In the Twilio console, on the number: **A call comes in → Webhook → HTTP POST →
`https://vestibule-hotline.ejfox.workers.dev/voice?k=<WEBHOOK_KEY>`**. We use an
api key rather than the account auth token, and only the auth token can check
`X-Twilio-Signature` — hence the url key.

- **Recipients:** `HOTLINE_EMAILS` in `wrangler.jsonc`. Each address must be
  verified in Cloudflare → Email Routing → Destination addresses first, or
  sends to it fail (the others still go out).
- **Greeting:** `../public/hotline-greeting.mp3` (Kokoro voice `am_puck`, ffmpeg
  trip-out ending in its own beep, so twilio's beep is off while `GREETING_URL`
  is set). Clear `GREETING_URL` to fall back to the `GREETING` robot + twilio beep.
- **Discord** shows only the last four digits of the caller's number.

## Reading the log

```sh
wrangler d1 execute vestibule --remote --command \
  "select created, caller, location, seconds, transcript from voicemails order by id desc limit 20"
```

## Gotchas

- Local `wrangler dev` runtime lags; the compat date is pinned to one it supports.
- Test locally with `.dev.vars` (`WEBHOOK_KEY=…`, `TWILIO_ACCOUNT_SID=…`,
  `DEV_ANY_RECORDING_HOST=1`); local `send_email` writes `.eml` files instead of sending.
  Never set `DEV_ANY_RECORDING_HOST` in production.
