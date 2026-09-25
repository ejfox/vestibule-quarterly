# Vestibule Quarterly

A quarterly journal for The Vestibule, an online community into computers,
behavior, and optimization. Live at **https://vestibulequarterly.com**.

Two pages:

- **`/`** — a spinning SVG seal masthead over a dithered Prometheus backdrop,
  the issue line, a "notify me" signup, and a quiet ticker to submissions.
- **`/submissions/`** — the call for work: full-bleed colossus hero, XXL title,
  outlined section numerals, a type-specimen list of kinds (Essays, Fiction,
  Memes, Code, Chains) with engravings, an Issue One prompt, a ledger of
  particulars, and a manuscript-slip submission form.

## Stack

Deliberately minimal — no build step, no framework, no dependencies. Static
`public/` on Cloudflare Pages, plus two Pages Functions backed by D1.

| Piece     | What                                                                  |
| --------- | --------------------------------------------------------------------- |
| Hosting   | Cloudflare Pages (static `public/`)                                   |
| Type      | Self-hosted variable fonts — Big Shoulders Display, Fraunces, Space Grotesk |
| Art       | Public-domain prints, dithered or cleaned to ink-on-white (`public/art/`) |
| Forms     | `functions/api/submit.js` + `subscribe.js` → D1 database `vestibule`   |

```
public/
  index.html               # home — copy is hand-written; find blocks by <!-- comments -->
  submissions/index.html   # call for work — same
  style.css                # ALL styling for both pages (tokens at the top)
  type.js                  # fades the masthead in once the fonts are ready
  signup.js                # home "notify me" → /api/subscribe
  submit-form.js           # submissions form → /api/submit
  gl.js                    # retired WebGL ink shader (commented out in index.html)
  _headers                 # no-cache for CSS/JS (see Caching below)
  art/                     # backdrops, prints, engravings, og-submissions.jpg share card
  fonts/                   # variable woff2, latin subset
functions/api/             # Pages Functions: subscribe + submit → D1
schema.sql                 # D1 tables: submissions, signups
wrangler.toml              # Pages project + output dir + D1 binding
```

## Design notes

- **Palette** is warm paper / ink / amber, defined once as tokens at the top of
  `style.css`, with a dark-mode set (plus faint CRT scanlines) under
  `prefers-color-scheme`.
- **Fraunces** has `opsz`, `wght`, `SOFT`, and `WONK` axes; the wobbly display
  italics (`.statement`, `.pull`, `.chain-q`) lean on them.
- **Engravings** in the kinds list are ink on white: `mix-blend-mode: multiply`
  on paper, `invert` + `screen` in dark. `.wrap` has a paper background because
  its `z-index` isolates it, and the blend needs a backdrop inside it.
- **Chains** are editorial, not a feature: people send pieces (text or video),
  and the editors stitch them into threads. There is no form option for it.
- Motion (seal spin, tickers, caret) stops under `prefers-reduced-motion`.
- There's a print stylesheet at the bottom of `style.css`.

## Local development

```sh
cd public && python3 -m http.server 8787   # static preview (forms won't post)
wrangler pages dev public                  # with Functions + local D1
```

## Deploy

Deploys run from a laptop with the **globally installed wrangler 4.92**, not
`npx wrangler` (newer versions misroute Pages deploys):

```sh
wrangler pages deploy public --project-name vestibule-quarterly --branch main --commit-dirty=true
```

The GitHub Action (`.github/workflows/deploy.yml`) deploys on push **only if**
the `CLOUDFLARE_API_TOKEN` repo secret exists; without it, the job passes and
leaves a notice. To turn CI deploys on, create a token with **Account →
Cloudflare Pages → Edit** and run
`gh secret set CLOUDFLARE_API_TOKEN --repo ejfox/vestibule-quarterly`.

## Caching

The zone's **Browser Cache TTL** (4h default) overrides `_headers` on the
custom domain, so browsers can pair fresh HTML with a stale `style.css`.
Until it's set to **Respect Existing Headers** (dashboard → Caching →
Configuration), **bump the `?v=` on the `style.css` / `submit-form.js` links
whenever you change them.**

## Reading submissions and signups

```sh
wrangler d1 execute vestibule --remote --command "SELECT * FROM submissions ORDER BY id DESC;"
wrangler d1 execute vestibule --remote --command "SELECT * FROM signups ORDER BY id DESC;"
```

## Credits

Fonts are SIL Open Font License. Art is public domain: Füger's *Prometheus*,
Vermeer's *The Art of Painting*, Volaire's *Eruption of Vesuvius*, engravings by
Tony Johannot and J.-J. Grandville, and de Terzi's 1670 airship. The Chains
engraving is Grandville via the Met (CC0, DP887660). The kinds engravings came
from Drake's cut of the site.
