# Handoff notes for agents

Read `README.md` first for what the site is and how it's deployed. This file
covers the working agreements, gotchas, and decisions that aren't obvious from
the code. Last updated 2026-09-25.

## Working agreements

- **Copy belongs to the humans.** Page copy is hand-written by the editors and
  marked by lowercase `<!-- block -->` comments. Don't reword it. Adding new
  lines is fine when asked; say which lines you added. Keep their voice:
  lowercase descriptions in the kinds list, no marketing tone.
- **Chains are editorial, not a feature.** People send pieces (text or video)
  and the editors stitch them into threads. No form option, no respond button,
  no "open/close" mechanics. This was explicitly removed; don't bring it back.
- **Zero build.** Static `public/`, one `style.css` (tokens at the top), small
  vanilla JS files. Don't add a framework, bundler, or npm dependency.
- **Match the comment style:** terse, lowercase, explains *why*.
- **Deploying is normal here.** The editors expect changes to be committed,
  deployed, and pushed once they've approved them. Check the live site after
  every deploy.

## Deploy and verify

```sh
wrangler pages deploy public --project-name vestibule-quarterly --branch main --commit-dirty=true
curl -sL https://vestibulequarterly.com/submissions/ | grep -c '<something you changed>'
```

- Use the **global wrangler 4.92**, never `npx wrangler` (newer versions
  misroute Pages deploys with "Missing entry-point").
- CI deploys are off until the `CLOUDFLARE_API_TOKEN` secret exists. The
  workflow skips and passes on purpose; that's not a bug.
- The wrangler OAuth login can deploy but **cannot edit zone settings or DNS**.
  Those are dashboard jobs for a human.

## Gotchas (each one has bitten us)

1. **Stale CSS on the live domain.** The zone's Browser Cache TTL overrides
   `_headers` (the `*.pages.dev` preview is fine). **Bump the `?v=` on the
   `style.css` and `submit-form.js` links in both HTML files whenever you change
   them.** The permanent fix (dashboard → Caching → Configuration → Browser
   Cache TTL → "Respect Existing Headers") is still pending with the editors.
   Symptom: a screenshot showing new markup with old styling.
2. **`mix-blend-mode` inside `.wrap`.** `.wrap` has `z-index: 1`, which isolates
   it, so it carries `background: var(--paper)` to give blends a backdrop.
   Remove that background and the engravings turn into solid boxes.
3. **Class collision:** `.plate` is the home page's reveal grid. Inline art on
   the submissions page is `.print`. Don't rename one to the other.
4. **Global `h1` / `h2` rules** also touch the home seal (`h1.seal`). Scope new
   heading styles to the submissions page or check the home page afterwards.
5. **Bare text nodes in `.genres li`** can't be grid-placed. That's why each
   description is wrapped in a `<span>`.
6. **Floats on wide screens:** `.print` floats right at ≥66rem. Bordered boxes
   next to it need `display: flow-root` (see `.chain`), or the float slides
   under them.
7. **Big Shoulders woff2 is variable** (weights 100–900, defaulting to 100). When
   rendering it with PIL, call `set_variation_by_axes([900])`.

## Checking visual changes

- Preview with `cd public && python3 -m http.server 8787`. It never caches,
  which is exactly why gotcha #1 doesn't show up locally.
- Check **dark and light** (the editors often run dark). To force light, inject
  the light `:root` tokens with `!important`.
- Check **phone width** (390px and 300px) for horizontal overflow:
  `document.documentElement.scrollWidth` should equal `innerWidth`. If the
  browser window won't resize, load the page in a 390px-wide `<iframe>`.
- Check `prefers-reduced-motion`: the tickers and seal must stop.

## Decisions already made (don't re-litigate)

- The submissions title is **plain ink**. A `mix-blend-mode: difference` version
  over the hero was tried and dropped because it turned blue over the amber art.
- Keep the dithered **Prometheus** backdrop on the home page; the editors like it.
- The kinds engravings come from Drake's cut (`vestibule-quarterly.drake.dev`).
  The Chains engraving is Grandville via the Met (CC0, DP887660), cleaned to ink
  on white. New art must be public domain or CC0. Magritte is **not** public
  domain.
- The WebGL shader (`gl.js`) is retired and commented out. Leave it unless asked.
- Video is accepted for any kind (about 10 minutes; a 60-second short counts).

## Open items

- [ ] Dashboard: set Browser Cache TTL to "Respect Existing Headers" (human task).
- [ ] Optional: add `CLOUDFLARE_API_TOKEN` to turn CI deploys on (human task).
- [ ] Rotate the Issue One prompt callout (`#prompt`, "Who's holding the pen?")
      when the editors pick the next one.
- [ ] Submissions pile up in D1; the query commands are in the README.
