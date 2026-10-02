-- Vestibule Quarterly — submissions + newsletter signups (Cloudflare D1)

CREATE TABLE IF NOT EXISTS submissions (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  created   TEXT    NOT NULL DEFAULT (datetime('now')),
  name      TEXT    NOT NULL,
  email     TEXT    NOT NULL,
  kind      TEXT,
  title     TEXT,
  link      TEXT,
  pitch     TEXT
);

CREATE TABLE IF NOT EXISTS signups (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  created   TEXT    NOT NULL DEFAULT (datetime('now')),
  email     TEXT    NOT NULL UNIQUE
);

-- hotline voicemails (hotline/ worker). the audio itself stays on twilio.
CREATE TABLE IF NOT EXISTS voicemails (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  created       TEXT    NOT NULL DEFAULT (datetime('now')),
  recording_sid TEXT    NOT NULL UNIQUE,
  call_sid      TEXT,
  caller        TEXT,
  location      TEXT,
  seconds       INTEGER,
  transcript    TEXT,
  recording_url TEXT,
  published     INTEGER NOT NULL DEFAULT 0  -- 1 = editors put it in the phone archive
);
