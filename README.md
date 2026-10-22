# Tournament — 16 teams, 4 stations, single-file app

A referee/scoreboard app for a 16-team, 4-station tournament (round-robin
Phase 1 → tie-for-8th → knockout). Pure vanilla HTML/JS, **no build step**.

## Run locally
Just open `tournament.html` in a browser (double-click, or `file://`).
Everything runs client-side; state persists in `localStorage`.

## Files
- `tournament.html` — the app UI + `App` view + `selfTest()` gate.
- `core.js` — the tournament "brain" (scheduling, standings, qualification,
  tiebreak, knockout, organizer/PIN, audit). UMD: `window.TOURNAMENT` in the
  browser, `module.exports` in Node. **No side effects** — pure functions over
  the `state` object.
- `tools/` — offline verification scripts (cscript/JScript mirrors; this box
  has no Node). Not part of the deployed site's behavior.

## Self-test
On load, `selfTest()` runs against a **scratch** copy of state and stamps a
badge in `#selftest` (`✓ Self-test passed` / `✗ Self-test failed: …`). This is
the ground-truth gate.

## Deploy (Vercel)
Push to GitHub, then import the repo in [Vercel](https://vercel.com). It's
static, so it deploys as-is. `vercel.json` rewrites `/` → `/tournament.html`,
so the clean URL `https://<project>.vercel.app/` works out of the box.

> Note: Vercel hosts the *app* (the shared URL everyone opens). Live
> cross-device winner sync still needs a free realtime store
> (Supabase/Firebase) — Vercel's `localStorage` is per-browser.
