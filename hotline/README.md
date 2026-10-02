# The Vestibule hotline

**(845) 493-3999.** Call, leave a message, and it shows up in our email (and
optionally Discord) with the mp3 attached and a rough Whisper transcript. Editors
can put a message in the **phone archive**: dial `*777` during the greeting to
hear the approved ones.

```
caller → twilio → POST /voice    greeting inside <Gather> (listens for ARCHIVE_CODE)
                                 → no keys: beep, <Record> (5 min max, # or hang up to finish)
                                 → *777: POST /archive, approved messages newest first
                                   (1 = skip, * = leave your own)
                → POST /recording  enqueue → queue(): fetch mp3 from twilio → R2 copy →
                                   whisper → email (with an approve link) → discord → D1
editor → GET /approve?sid&sig    listen, put it in / pull it from the phone archive
```

One Worker (`src/index.js`), no dependencies. Lives at
https://vestibule-hotline.ejfox.workers.dev.

| Piece       | What                                                                       |
| ----------- | -------------------------------------------------------------------------- |
| Phone       | Twilio number, "a call comes in" webhook → `POST /voice`                   |
| Auth        | we only mail recordings we fetch from our own account, by sid              |
| Slow work   | Queue `vestibule-hotline` (waitUntil's ~30s isn't enough), 5 retries       |
| Failures    | dead-letter queue `vestibule-hotline-dlq` → emails the editors             |
| Audio       | R2 bucket `vestibule-hotline`, `<RecordingSid>.mp3` (Twilio keeps one too) |
| Transcript  | Workers AI `@cf/openai/whisper-large-v3-turbo`, `vad_filter` on            |
| Email       | Email Routing `send_email` from `hotline@vestibulequarterly.com`           |
| Log         | D1 `vestibule`, table `voicemails`; `published = 1` → in the phone archive |
| Greeting    | `../public/hotline-greeting.mp3` (Kokoro `am_puck` + ffmpeg trip-out)      |

## Setup

```sh
wrangler secret put TWILIO_ACCOUNT_SID
wrangler secret put TWILIO_API_KEY         # SK… — a revocable api key ("Vestibule-API")
wrangler secret put TWILIO_API_SECRET      # its secret; downloads recordings
openssl rand -hex 32 | wrangler secret put APPROVE_SECRET   # signs approve links
wrangler secret put DISCORD_WEBHOOK_URL    # optional — unset means no discord post
wrangler deploy
```

In the Twilio console, on the number: **A call comes in → Webhook → HTTP POST →
`https://vestibule-hotline.ejfox.workers.dev/voice`**. No secret in the url:
a forged callback can only name a recording, and we download it from our own
account by sid, so a fake one 404s and is dropped. (Only the account auth token
can check `X-Twilio-Signature`, and we'd rather hold a revocable api key.)

- **Recipients:** `HOTLINE_EMAILS` in `wrangler.jsonc`. Each address must be
  verified in Cloudflare → Email Routing → Destination addresses first, or
  sends to it fail (the others still go out).
- **Archive code:** `ARCHIVE_CODE`. Its length sets how many keys the greeting
  listens for.
- **Greeting:** fades out with no beep of its own; twilio's beep follows. Bump
  `?v=` in `GREETING_URL` whenever the mp3 changes (twilio and the zone cache it).
  Clear `GREETING_URL` to fall back to the `GREETING` robot.
- **Approve links** are HMAC-signed per recording. Publishing is a POST, so
  mail scanners that prefetch links can't publish anything.
- **Discord** and the approve page show only the last four digits of the caller.

## Reading the log

```sh
wrangler d1 execute vestibule --remote --command \
  "select created, caller, location, seconds, published, transcript from voicemails order by id desc limit 20"
wrangler r2 object get vestibule-hotline/<RecordingSid>.mp3 --remote --file msg.mp3
```

## Gotchas

- Twilio's `<Record>` hangs up after 5s of silence by default; we set 30.
- Whisper "hears" silence as "Thank you."; `vad_filter` stops that.
- Local `wrangler dev` runtime lags; the compat date is pinned to one it supports.
- Test locally with `.dev.vars` (`TWILIO_ACCOUNT_SID=…`, `APPROVE_SECRET=…`,
  `DEV_ANY_RECORDING_HOST=1`, which fetches `RecordingUrl` as given); local
  `send_email` writes `.eml` files instead of sending. In zsh, don't pass curl
  args through an unquoted variable (no word splitting).
  Never set `DEV_ANY_RECORDING_HOST` in production.
