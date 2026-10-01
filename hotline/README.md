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
| Auth         | every Twilio request is checked against `X-Twilio-Signature`      |
| Slow work    | Queue `vestibule-hotline` (waitUntil's ~30s isn't enough)         |
| Transcript   | Workers AI `@cf/openai/whisper-large-v3-turbo`                    |
| Email        | Email Routing `send_email` from `hotline@vestibulequarterly.com`  |
| Log          | D1 `vestibule`, table `voicemails` (audio itself stays on Twilio) |

## Setup

```sh
wrangler secret put TWILIO_ACCOUNT_SID
wrangler secret put TWILIO_AUTH_TOKEN      # primary auth token; signs + downloads
wrangler secret put DISCORD_WEBHOOK_URL    # optional — unset means no discord post
wrangler deploy
```

In the Twilio console, on the number: **A call comes in → Webhook → HTTP POST →
`https://vestibule-hotline.ejfox.workers.dev/voice`**.

- **Recipients:** `HOTLINE_EMAILS` in `wrangler.jsonc`. Each address must be
  verified in Cloudflare → Email Routing → Destination addresses first, or
  sends to it fail (the others still go out).
- **Greeting:** edit `GREETING` / `GOODBYE`, or record one and set
  `GREETING_URL` to the mp3 (e.g. drop it in `../public/`).
- **Discord** shows only the last four digits of the caller's number.

## Reading the log

```sh
wrangler d1 execute vestibule --remote --command \
  "select created, caller, location, seconds, transcript from voicemails order by id desc limit 20"
```

## Gotchas

- Local `wrangler dev` runtime lags; the compat date is pinned to one it supports.
- Test locally with `.dev.vars` (`TWILIO_AUTH_TOKEN=…`, `DEV_ANY_RECORDING_HOST=1`)
  and sign requests yourself; local `send_email` writes `.eml` files instead of sending.
  Never set `DEV_ANY_RECORDING_HOST` in production.
