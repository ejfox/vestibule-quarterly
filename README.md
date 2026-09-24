# Vestibule Quarterly

A small quarterly magazine about thresholds and waiting rooms, and the moment
before you act. Live at **https://vestibulequarterly.com**.

The landing page is one avant-garde composition: a full-bleed WebGL ink field
behind an animated variable-font masthead, with an issue index and a "notify
me" signup.

## Stack

Deliberately minimal — no build step, no framework, no dependencies. Same recipe
as [spliffs.org](https://spliffs.org): static `public/` on Cloudflare Pages.

| Piece      | What                                                                 |
| ---------- | ------------------------------------------------------------------- |
| Hosting    | Cloudflare Pages (static `public/`)                                  |
| Type       | Self-hosted variable fonts — Fraunces (display) + Space Grotesk (UI) |
| Background | Hand-rolled WebGL fragment shader (`public/gl.js`)                   |
| Typography | Live variable-axis animation (`public/type.js`)                     |
| Signup     | Formspree `<form>` (swap the action URL) — or add a Pages Function   |

```
public/
  index.html            # landing page — mostly content, links style.css
  submissions/index.html  # submissions page — same
  style.css             # ALL styling for both pages (colors/type in TOKENS)
  gl.js                 # WebGL domain-warp "ink on paper" background
  type.js               # fades the masthead in once the fonts are ready
  signup.js             # landing-page "notify me" form → /api/subscribe
  submit-form.js        # submissions form → /api/submit
  favicon.svg           # threshold / doorway mark (theme-aware)
  fonts/
    Fraunces-var.woff2      # variable display serif (latin subset)
    SpaceGrotesk-var.woff2  # variable UI sans (latin subset)
functions/api/          # Pages Functions: subscribe + submit → D1
wrangler.toml           # Pages project + output dir + D1 binding
```

## The avant-garde bits

- **Ink field** (`gl.js`) — a 6-octave fbm domain warp rendered to a full-screen
  triangle, clamped to a black-on-bone "print" palette with contour banding and
  a faint grain. Reacts softly to the pointer. Degrades to blank canvas (CSS
  paper background shows through) with no WebGL, and renders a single static
  frame under `prefers-reduced-motion`.
- **Living title** (`type.js`) — the masthead is split into per-letter spans for
  a blurred staggered reveal, then each word's Fraunces axes (`opsz`, `wght`,
  `SOFT`, `WONK`) drift on offset sine waves so the type never settles. The
  second word is drawn as an outline via `-webkit-text-stroke`. Reduced motion
  keeps the reveal, drops the perpetual drift.

Tune the ink look at the top of the fragment shader in `gl.js`; tune the type
motion in the `tick()` axis math in `type.js`.

## Fonts

Both are variable `woff2`, latin subset, self-hosted (zero external requests):

- **Fraunces** — SIL Open Font License. Axes: optical size, weight, softness,
  wonk.
- **Space Grotesk** — SIL Open Font License.

Re-fetch a subset from Google Fonts' `css2` API if you need more glyphs.

## Local development

```sh
npx wrangler pages dev public      # serves public/ locally
# or just open public/index.html in a browser
```

## Deploy

**Manual:**

```sh
npx wrangler pages deploy          # uploads public/ to the "vestibule-quarterly" project
```

**Automatic (CI):** every push to `main` deploys via
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). Needs one repo
secret:

- `CLOUDFLARE_API_TOKEN` — a token with **Account → Cloudflare Pages → Edit**.
  Create at <https://dash.cloudflare.com/profile/api-tokens>, then:

  ```sh
  gh secret set CLOUDFLARE_API_TOKEN --repo ejfox/vestibule-quarterly
  ```

Use **either** this CI flow **or** Cloudflare's native "Connect to Git" — not
both, or you'll double-deploy.

## DNS

The zone `vestibulequarterly.com` lives in the same Cloudflare account. To point
the apex at Pages, add one proxied CNAME:

| Type  | Name       | Target                        | Proxy   |
| ----- | ---------- | ----------------------------- | ------- |
| CNAME | `@` (apex) | `vestibule-quarterly.pages.dev` | Proxied |

Cloudflare flattens the apex CNAME automatically. Also register the custom
domain on the Pages project (Pages → **vestibule-quarterly** → Custom domains)
so it provisions the edge TLS cert. Both must exist: the CNAME (resolution) and
the custom-domain entry (routing + cert).

## Signup

The form posts to Formspree by default — create a form at
<https://formspree.io>, then replace `your-form-id` in the `<form action>` in
`public/index.html`. To self-host instead, add `functions/api/subscribe.js` +
a D1 table (see spliffs.org's `functions/api/count.js` for the pattern).
