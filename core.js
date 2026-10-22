/* =========================================================================
   core.js — the TOURNAMENT core, extracted from tournament.html.

   UMD module: loads as a browser global (window.TOURNAMENT) via
   <script src="core.js">, and as a CommonJS export (module.exports) in a
   serverless function. The body is a byte-faithful copy of the inline core
   that used to live in tournament.html (lines 409-828) — same functions,
   same returned API object — so nothing else in the app changes.

   Pure-core contract (unchanged): every rule/state function reads or mutates
   ONLY the `state` object passed to it and never calls save(). The App layer
   persists after a successful action. `ensure()` is the one exception: it
   builds a fresh state when none is loaded. (In a later step a storage
   adapter replaces the localStorage-backed load/save/ensure with a shared
   backend, but the pure logic here is already backend-agnostic.)
   ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();           // CommonJS (serverless function / Node)
  } else {
    root.TOURNAMENT = factory();          // browser global
  }
})(typeof self !== 'undefined' ? self : this, function () {
  // ---- your randomly-chosen 16 countries (fixed, stable) ----
  const TEAMS = [
    'Brazil', 'Japan', 'Canada', 'Germany', 'Australia', 'Mexico',
    'Kenya', 'Norway', 'South Korea', 'Italy', 'Netherlands', 'Egypt',
    'New Zealand', 'Poland', 'Chile', 'Spain'
  ];
  const STATIONS = 4;   // games that can run in parallel each round
  const SEED     = 20261008; // deterministic -> the same schedule every load
  const KEY      = 'tournament.v1';

  // ---- deterministic PRNG (reproducible schedule) ----
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Circle method: 15 perfect matchings, each 8 disjoint pairs, all 120 pairs once.
  function circleRounds(n) {
    let a = [...Array(n).keys()];
    const rounds = [];
    for (let r = 0; r < n - 1; r++) {
      const pairs = [];
      for (let i = 0; i < n / 2; i++) pairs.push([a[i], a[n - 1 - i]]);
      rounds.push(pairs);
      a = [a[0], a[n - 1], ...a.slice(1, n - 1)];
    }
    return rounds;
  }

  function generateSchedule(n, stations, rng) {
    const all = circleRounds(n);
    const idx = shuffle([...all.keys()], rng).slice(0, 6);
    const chosen = idx.map(i => all[i]);          // 6 matchings
    const size = Math.max(1, stations);
    const chunks = [];
    for (const m of chosen) for (let s = 0; s < m.length; s += size) chunks.push(m.slice(s, s + size));
    const per = Math.ceil((n / 2) / size);
    const rounds = [];
    for (let c = 0; c < per; c++)
      for (let mi = 0; mi < chosen.length; mi++) {
        const id = mi * per + c;
        if (chunks[id]) rounds.push(chunks[id]);
      }
    return rounds;
  }

  function validate(sched, n, stations) {
    const cnt = new Array(n).fill(0);
    const seen = new Set();
    let total = 0;
    sched.forEach((pairs, r) => {
      const inR = new Set();
      for (const [a, b] of pairs) {
        if (inR.has(a) || inR.has(b)) throw new Error('team twice in same round ' + r);
        inR.add(a); inR.add(b);
        const key = Math.min(a, b) + '-' + Math.max(a, b);
        if (seen.has(key)) throw new Error('rematch ' + key);
        seen.add(key); total++;
        cnt[a]++; cnt[b]++;
      }
      if (pairs.length > stations) throw new Error('round ' + r + ' too full');
    });
    cnt.forEach((c, i) => { if (c !== 6) throw new Error('team ' + i + ' has ' + c + ' games'); });
    if (total !== n * 3) throw new Error('total games ' + total + ' != ' + n * 3);
    return true;
  }

  // ---- persistent state (survives reload) ----
  function load() {
    try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.teams && s.schedule) return s; }
    catch (e) { /* fall through to regenerate */ }
    return null;
  }
  function save(state) { localStorage.setItem(KEY, JSON.stringify(state)); }

  function ensure() {
    let state = load();
    if (state && state.pinHash === undefined) {
      // Migrate saves from before the organizer-PIN field: default the hash so
      // the documented default PIN (1234) still unlocks an old state.
      state.pinHash = pinHash(DEFAULT_PIN);
      save(state);
    }
    if (!state) {
      state = {
        version: 1,
        phase: 'phase1',               // phase1 | tiebreak | phase2 | done
        teams: TEAMS.slice(),
        stations: STATIONS,
        seed: SEED,
        schedule: generateSchedule(TEAMS.length, STATIONS, mulberry32(SEED)),
        results: {},                   // "<a>-<b>" -> winner team index
        audit: [],                     // {t, actor, game, winner, note}
        archives: [],                  // past tournaments (start-fresh preserves these)
        pinHash: pinHash(DEFAULT_PIN)  // organizer PIN, stored hashed (never in the clear)
      };
      save(state);
    }
    return state;
  }

  /* ---- REFEEE / declare (Step 2): scoped, two-button, once-and-locked ---- */

  // Canonical key for a pair, independent of order.
  function gameKey(a, b) { return Math.min(a, b) + '-' + Math.max(a, b); }

  // The [a,b] at a station (roundIdx, stationIdx), or null.
  function stationOf(state, roundIdx, stationIdx) {
    const round = state.schedule[roundIdx];
    if (!round) return null;
    return round[stationIdx] || null;
  }

  // Winner already recorded for this pair? (index, or null if still open.)
  function resultFor(state, a, b) {
    const w = state.results[gameKey(a, b)];
    return (w === undefined) ? null : w;
  }

  function declaredCount(state) { return Object.keys(state.results).length; }

  // Declare a winner for one station. Enforces: valid station, winner is one
  // of the two teams, and the game is still open. Once set, it is immutable
  // (a second call is refused). Every successful call is audited.
  function declare(state, roundIdx, stationIdx, winnerIdx, actor) {
    const pair = stationOf(state, roundIdx, stationIdx);
    if (!pair) return { ok: false, error: 'no such station' };
    const a = pair[0], b = pair[1];
    if (winnerIdx !== a && winnerIdx !== b) return { ok: false, error: 'winner is not a team in this match' };
    const key = gameKey(a, b);
    if (state.results[key] !== undefined) {
      return { ok: false, error: 'already decided', winner: state.results[key] };
    }
    state.results[key] = winnerIdx;
    state.audit.push({
      t: new Date().toISOString(),
      actor: actor || ('station R' + (roundIdx + 1) + 'S' + (stationIdx + 1)),
      round: roundIdx + 1, station: stationIdx + 1,
      game: [a, b], winner: winnerIdx, note: 'declared'
    });
    return { ok: true, key: key, winner: winnerIdx };
  }

  // ---- live TV helpers (Step 3) ----
  // Standings computed from results, never typed by a human. Winner = 1 pt,
  // loser = 0. Sorted by points (ties keep original seed order). Top 8 advance.
  function standings(state) {
    const n = state.teams.length;
    const rows = [];
    for (let i = 0; i < n; i++) rows.push({ idx: i, played: 0, wins: 0, losses: 0, pts: 0 });
    Object.keys(state.results).forEach(key => {
      if (!/^\d+-\d+$/.test(key)) return;   // only base games; ignore tb-/ko- keys
      const w = state.results[key];
      const parts = key.split('-');
      const a = Number(parts[0]), b = Number(parts[1]);
      const l = (w === a) ? b : a;   // loser is the other team
      if (rows[w]) { rows[w].played++; rows[w].wins++; rows[w].pts += 1; }
      if (rows[l]) { rows[l].played++; rows[l].losses++; }
    });
    rows.sort((x, y) => (y.pts - x.pts) || (x.idx - y.idx));
    return rows;
  }

  // All decided BASE games (phase-1 only — "a-b" keys), oldest -> newest
  // (render reverses for newest-first). Tiebreak/knockout results have
  // namespaced keys ("tb-a-b", "ko-r1m1") and are shown in the bracket.
  function latestResults(state) {
    const out = [];
    Object.keys(state.results).forEach(key => {
      if (!/^\d+-\d+$/.test(key)) return;
      const w = state.results[key];
      const parts = key.split('-');
      const a = Number(parts[0]), b = Number(parts[1]);
      out.push({ a, b, winner: w });
    });
    return out;
  }

  /* ---- STEP 4: qualification, tiebreak, knockout  (PURE, same contract) ----
     Reads only state.results + state.teams; never saves. Advancement is
     RECOMPUTED from results on every call, so an organizer correction to any
     decided game (phase-1, tiebreak, or knockout) automatically re-flows the
     standings AND the bracket. --------------------------------------------- */

  // How many of the 48 base games are decided?
  function phase1Decided(state) {
    let done = 0, total = 0;
    state.schedule.forEach(round => round.forEach(([a, b]) => {
      total++;
      if (state.results[gameKey(a, b)] !== undefined) done++;
    }));
    return { done, total, complete: done === total };
  }

  // Qualification rules (designed with the user):
  //  - points line = the 8th-ranked team's points (standings are sorted
  //    points desc, then seed asc, so "8th-ranked" is deterministic);
  //  - strictly above the line: auto-advance;
  //  - on the line: if there are no more open slots than teams on the line,
  //    everyone advances (no tiebreak needed);
  //  - otherwise the TWO highest-seeded on-line teams play ONE tiebreak game;
  //    the winner takes one slot, any remaining slots fill in seed order
  //    from the rest of the on-line teams.
  // Generalizes the common case: 7 teams above, 2 on the line, 1 slot left
  // -> exactly one tiebreak game.
  function qualification(state) {
    const rows = standings(state);
    const line = rows[7].pts;
    const above = rows.filter(r => r.pts > line);
    const onLine = rows.filter(r => r.pts === line);   // seed order (already sorted)
    const open = 8 - above.length;
    if (onLine.length <= open) {
      const adv = above.concat(onLine).map(r => r.idx);
      return { advanced: adv, tiebreak: null, line };
    }
    const tiebreak = onLine.slice(0, 2).map(r => r.idx);
    const spill = onLine.slice(2);
    return {
      advanced: above.concat(spill.slice(0, Math.max(0, open - 1))).map(r => r.idx),
      tiebreak: tiebreak,
      line: line
    };
  }

  // Tiebreak game result key (namespaced so it never collides with "a-b").
  function tiebreakKey(a, b) { return 'tb-' + gameKey(a, b); }

  // The 8 advancing teams in rank order (1..8), or null + the pending
  // tiebreak pair if that game is not yet decided.
  function advancement(state) {
    const q = qualification(state);
    const ranked = set => standings(state)
      .filter(r => set.indexOf(r.idx) !== -1)
      .map(r => r.idx);
    if (!q.tiebreak) return { advanced: ranked(q.advanced), resolved: true };
    const key = tiebreakKey(q.tiebreak[0], q.tiebreak[1]);
    const w = state.results[key];
    if (w === undefined) {
      return { advanced: null, resolved: false, tiebreak: q.tiebreak, key };
    }
    return { advanced: ranked(q.advanced.concat([w])), resolved: true };
  }

  // Declare the winner of an arbitrary named match (tiebreak "tb-a-b" or
  // knockout "ko-rRmM"). Same once-and-locked + audit contract as declare().
  function declareMatch(state, key, a, b, winnerIdx, actor, label) {
    if (a == null || b == null) return { ok: false, error: 'match not set yet — earlier round undecided' };
    if (winnerIdx !== a && winnerIdx !== b) return { ok: false, error: 'winner is not a team in this match' };
    if (state.results[key] !== undefined) {
      return { ok: false, error: 'already decided', winner: state.results[key] };
    }
    state.results[key] = winnerIdx;
    state.audit.push({
      t: new Date().toISOString(),
      actor: actor || 'referee',
      game: [a, b], winner: winnerIdx,
      note: 'declared' + (label ? ' — ' + label : '')
    });
    return { ok: true, key: key, winner: winnerIdx };
  }

  // Knockout bracket: QF seeds 1v8 2v7 3v6 4v5 (rank = points, then seed).
  // Round r match m takes the winner of round r-1 matches 2m and 2m+1.
  // Teams are filled in as earlier rounds decide; null = TBC.
  function bracket(state) {
    const adv = advancement(state);
    if (!adv.advanced) return null;
    const A = adv.advanced;
    const winOf = (m) => (state.results[m.key] !== undefined) ? state.results[m.key] : null;
    const mk = (r, m, a, b) => ({ key: 'ko-r' + r + 'm' + m, r: r, m: m, a: a, b: b });
    const qf = [
      mk(1, 1, A[0], A[7]),
      mk(1, 2, A[1], A[6]),
      mk(1, 3, A[2], A[5]),
      mk(1, 4, A[3], A[4])
    ];
    const sf = [
      mk(2, 1, winOf(qf[0]), winOf(qf[1])),
      mk(2, 2, winOf(qf[2]), winOf(qf[3]))
    ];
    const fin = [ mk(3, 1, winOf(sf[0]), winOf(sf[1])) ];
    return { rounds: [qf, sf, fin] };
  }

  // Which phase are we in, right now (derived, never stored stale)?
  function currentPhase(state) {
    const p1 = phase1Decided(state);
    if (!p1.complete) return { phase: 'phase1', p1 };
    const adv = advancement(state);
    if (!adv.resolved) return { phase: 'tiebreak', p1, tiebreak: adv.tiebreak, key: adv.key };
    const bk = bracket(state);
    const finalM = bk.rounds[2][0];
    const champ = (state.results[finalM.key] !== undefined) ? state.results[finalM.key] : null;
    return { phase: (champ !== null) ? 'done' : 'phase2', p1, champion: champ, bracket: bk };
  }

  /* ---- ORGANIZER / admin core (Step 5) ----
     PURE: mutate (or build & return) the state that is passed in, and never
     call save(). The App layer persists after a successful action. This keeps
     the self-test side-effect free (no phantom writes on page load). -------- */

  // Local organizer PIN gate. Honest about scope: this is a UI affordance on
  // a single file with no server — it stops a teammate from casually opening
  // the console, it is NOT credential-grade auth. The PIN is stored only as a
  // hash; the clear value never touches localStorage.
  const DEFAULT_PIN = '1234';
  function pinHash(pin) {             // djb2 -> 32-bit; deterministic, no deps
    let h = 5381;
    const s = String(pin);
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return 'h' + (h >>> 0).toString(16);
  }
  function checkPin(state, pin) {
    // A state saved before the pinHash field has none — treat that as the
    // documented default so 1234 keeps working on such saves.
    const expected = (state.pinHash !== undefined) ? state.pinHash : pinHash(DEFAULT_PIN);
    return expected === pinHash(pin);
  }
  function setPin(state, pin, actor) {
    if (!/^\d{4,8}$/.test(String(pin))) return { ok: false, error: 'PIN must be 4-8 digits' };
    state.pinHash = pinHash(pin);
    state.audit.push({
      t: new Date().toISOString(),
      actor: actor || 'organizer',
      note: 'PIN changed'
    });
    return { ok: true };
  }
  // Escape hatch for a lockout: restore the documented default PIN (1234).
  // Audited distinctly from a change, and — like everything here — hash-only.
  function resetPin(state, actor) {
    state.pinHash = pinHash(DEFAULT_PIN);
    state.audit.push({
      t: new Date().toISOString(),
      actor: actor || 'organizer',
      note: 'PIN reset to default'
    });
    return { ok: true };
  }

  // The ONLY authorized path to change a decided game. Refuses an open game and
  // a foreign-team winner. Records the previous winner + the new one in the
  // audit trail. Keyed explicitly, so it works for phase-1 ("a-b") and the
  // later "tb-"/"ko-" keys alike.
  function correctResult(state, key, a, b, newWinner, actor) {
    if (state.results[key] === undefined) return { ok: false, error: 'game not decided' };
    if (newWinner !== a && newWinner !== b) return { ok: false, error: 'winner is not a team in this match' };
    const prev = state.results[key];
    state.results[key] = newWinner;
    state.audit.push({
      t: new Date().toISOString(),
      actor: actor || 'organizer',
      game: [a, b], prev: prev, winner: newWinner,
      note: 'correction (organizer override)'
    });
    return { ok: true, key: key, prev: prev, winner: newWinner };
  }

  // Start fresh. A plain wipe would also erase the audit trail — itself a
  // tamper vector — so we ARCHIVE the finished tournament (results + full
  // audit) and only then return a clean Phase-1 state. The reset is itself
  // the first audit entry on the new tournament, so the trail is unbroken.
  function resetTournament(state, actor) {
    const now = new Date().toISOString();
    const entry = {
      id: (state.archives ? state.archives.length : 0) + 1,
      archivedAt: now,
      phase: state.phase,
      gamesDecided: Object.keys(state.results).length,
      teams: state.teams.slice(),
      stations: state.stations,
      seed: state.seed,
      schedule: state.schedule,
      results: state.results,
      audit: state.audit.slice()
    };
    const fresh = {
      version: 1,
      phase: 'phase1',
      teams: state.teams.slice(),
      stations: state.stations,
      seed: state.seed,
      schedule: generateSchedule(state.teams.length, state.stations, mulberry32(state.seed)),
      results: {},
      audit: [{
        t: now,
        actor: actor || 'organizer',
        note: 'reset - previous tournament archived #' + entry.id
      }],
      archives: (state.archives ? state.archives.slice() : []).concat([entry]),
      pinHash: state.pinHash || pinHash(DEFAULT_PIN)   // the console PIN survives a reset
    };
    return fresh;
  }

  return {
    TEAMS, STATIONS, SEED, KEY,
    mulberry32, shuffle, circleRounds, generateSchedule, validate,
    ensure, load, save,
    gameKey, stationOf, resultFor, declaredCount, declare,
    phase1Decided, qualification, tiebreakKey, advancement, declareMatch,
    bracket, currentPhase,
    correctResult, resetTournament,
    DEFAULT_PIN, checkPin, setPin, resetPin,
    standings, latestResults
  };
});
