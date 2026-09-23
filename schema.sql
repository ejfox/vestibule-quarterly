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
