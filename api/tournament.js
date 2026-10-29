/* =========================================================================
   api/tournament.js — the shared store + rules source-of-truth, as a Vercel
   serverless function.

   Why a function (not just static files): static hosting serves the same HTML
   to every device, but each device's localStorage is private — a referee on a
   phone and the organiser on the TV machine would not see each other. This
   function is the ONE place every device agrees on: referees POST a small,
   named action (e.g. "declare winner of R1S2"), it runs that action through
   the SAME core.js the browser uses, and stores the resulting state in Upstash
   Redis. Every other device re-GETs and converges. Nothing to download, and
   every action is re-validated here, so no client can write an invalid result.

   Stack (all free): Vercel function + Upstash Redis (free tier, no credit
   card). Credentials come from Vercel env vars — UPSTASH_REDIS_REST_URL and
   UPSTASH_REDIS_REST_TOKEN — and never live in this repo.

   Upstash is reached over its plain REST API (global fetch), so there are ZERO
   npm dependencies: Vercel installs nothing and there is no package.json to
   version-rot. ---------------------------------------------------------------- */
'use strict';
const T = require('../core.js');           // UMD -> module.exports

const DB_KEY   = 'tournament:doc';         // the shared state document
const LOCK_KEY = 'tournament:lock';        // short write lock (create/replace)

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

// Minimal Upstash Redis REST client (GET / SET / DEL is all we need).
async function redis(command, options) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const tok = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !tok) throw new Error('Upstash not configured');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + tok
    },
    body: JSON.stringify(options ? { command: command, options: options } : { command: command })
  });
  let body;
  try { body = await res.json(); }
  catch (e) { throw new Error('bad response from Upstash'); }
  if (body && body.error) throw new Error(body.error);
  return body ? body.result : null;
}

// Run ONE action through the shared core. `state` is mutated in place (the
// core's pure contract); `reset` is the one that returns a fresh state.
// Returns {res, fresh?, code?} — code is the HTTP status for failures.
function applyOp(state, op) {
  const actor = (op.actor && op.actor) ? op.actor : 'referee';
  switch (op.op) {
    case 'declare':
      return { res: T.declare(state, op.roundIdx, op.stationIdx, op.winnerIdx, actor) };
    case 'declareMatch':
      return { res: T.declareMatch(state, op.key, op.a, op.b, op.winnerIdx, actor, op.label) };
    case 'correct':
      if (!T.checkPin(state, op.pin)) return { res: { ok: false, error: 'bad organizer PIN' }, code: 401 };
      return { res: T.correctResult(state, op.key, op.a, op.b, op.newWinner, actor) };
    case 'setPin':
      if (!T.checkPin(state, op.pin)) return { res: { ok: false, error: 'bad current PIN' }, code: 401 };
      return { res: T.setPin(state, op.next, actor) };
    case 'reset':
      if (!T.checkPin(state, op.pin)) return { res: { ok: false, error: 'bad organizer PIN' }, code: 401 };
      return { res: { ok: true }, fresh: T.resetTournament(state, actor) };
    case 'resetPin':
      // Documented escape hatch: no PIN required (audited distinctly in core).
      return { res: T.resetPin(state, actor) };
    default:
      return { res: { ok: false, error: 'unknown action' }, code: 400 };
  }
}

exports.handler = async function (req, res) {
  // --- GET: read the current shared state (or 202 while someone is creating) ---
  if (req.method === 'GET') {
    try {
      const raw = await redis(['GET', DB_KEY]);
      if (raw !== null && raw !== undefined) {
        return json(200, { ok: true, state: JSON.parse(raw) });
      }
      // No doc yet. If a create is in flight, tell the client to wait a beat;
      // otherwise the client is free to be the first writer (see POST).
      const lock = await redis(['GET', LOCK_KEY]);
      if (lock !== null && lock !== undefined) {
        return json(202, { ok: false, creating: true, retryAfterMs: 1000 });
      }
      return json(202, { ok: false, empty: true, retryAfterMs: 1000 });
    } catch (e) {
      return json(503, { ok: false, error: (e && e.message) || 'store unavailable' });
    }
  }

  // --- POST: apply one action under a short write lock --------------------------
  if (req.method !== 'POST') {
    return json(405, { ok: false, error: 'method not allowed' });
  }
  let op;
  try { op = (req.body && req.body.op) ? req.body.op : null; }
  catch (e) { return json(400, { ok: false, error: 'bad request body' }); }
  if (!op || !op.op) return json(400, { ok: false, error: 'missing action' });

  // Acquire a 5s lock so two first-writers can't clobber each other.
  const token = (Math.random().toString(36).slice(2) + Date.now().toString(36));
  let got;
  try {
    got = await redis(['SET', LOCK_KEY, token], { nx: true, px: 5000 });
  } catch (e) {
    return json(503, { ok: false, error: (e && e.message) || 'store unavailable' });
  }
  if (got !== 'OK') {
    return json(429, { ok: false, error: 'busy, retry', retryAfterMs: 1000 });
  }

  try {
    const raw = await redis(['GET', DB_KEY]);
    let state = (raw !== null && raw !== undefined) ? JSON.parse(raw) : null;
    if (!state) state = T.fresh();        // first writer seeds the tournament

    const out = applyOp(state, op);
    if (!out.res.ok) {
      // Map core's "already decided" to a 409 so clients can tell it apart from
      // a real error; everything else is a 400.
      const code = out.code || (/already decided/.test(out.res.error) ? 409 : 400);
      return json(code, { ok: false, error: out.res.error });
    }

    const finalState = out.fresh || state;
    finalState.rev = (state && state.rev) ? state.rev + 1 : 1;
    await redis(['SET', DB_KEY, JSON.stringify(finalState)]);
    return json(200, { ok: true, state: finalState, rev: finalState.rev });
  } catch (e) {
    return json(500, { ok: false, error: (e && e.message) || 'internal error' });
  } finally {
    try { await redis(['DEL', LOCK_KEY]); } catch (e) { /* lock auto-expires */ }
  }
};
