/* Standalone Step-5 organizer-core verifier.
   ES5 (JScript) so it runs under cscript.exe with no other runtime installed.
   Mirrors the SAME correctResult / resetTournament shipped in tournament.html:
   both are PURE (mutate/return the passed state, no save), so what you verify
   here is what the app uses. */

// Math.imul polyfill — JScript predates ES6; browsers have it natively.
function imul(a, b) {
  var ah = (a >>> 16) & 0x7fff, al = a & 0xffff;
  var bh = (b >>> 16) & 0x7fff, bl = b & 0xffff;
  return ((al * bh + ah * bl << 16) + al * bl) | 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = imul(a ^ (a >>> 15), 1 | a);
    t = (t + imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rng) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(rng() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
/* Circle method: n-1 perfect matchings, covering every pair exactly once. */
function circleRounds(n) {
  var a = []; for (var i = 0; i < n; i++) a.push(i);
  var rounds = [];
  for (var r = 0; r < n - 1; r++) {
    var pairs = [];
    for (var i2 = 0; i2 < n / 2; i2++) pairs.push([a[i2], a[n - 1 - i2]]);
    rounds.push(pairs);
    var rest = []; for (var k = 1; k < n - 1; k++) rest.push(a[k]);
    a = [a[0], a[n - 1]].concat(rest);
  }
  return rounds; // 15 matchings for n=16
}
/* Pick 6 matchings (seeded -> reproducible), split into rounds of STATIONS. */
function generateSchedule(n, stations, rng) {
  var all = circleRounds(n);
  var idx = []; for (var i = 0; i < all.length; i++) idx.push(i);
  idx = shuffle(idx, rng);
  var chosen = [];
  for (var c = 0; c < 6; c++) chosen.push(all[idx[c]]);
  var size = Math.max(1, stations);
  var chunks = [];
  for (var m = 0; m < chosen.length; m++) {
    var pairs = chosen[m];
    for (var s = 0; s < pairs.length; s += size) chunks.push(pairs.slice(s, s + size));
  }
  var per = Math.ceil((n / 2) / size); // rounds each matching spans
  var rounds = [];
  for (var ch = 0; ch < per; ch++) {
    for (var mi = 0; mi < chosen.length; mi++) {
      var id = mi * per + ch;
      if (chunks[id]) rounds.push(chunks[id]);
    }
  }
  return rounds;
}

function nkeys(o) { var c = 0; for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) c++; return c; }
function gameKey(a, b) { return Math.min(a, b) + '-' + Math.max(a, b); }

/* ---- the two organizer-core functions under test (PURE) ---- */
function correctResult(state, key, a, b, newWinner, actor) {
  if (state.results[key] === undefined) return { ok: false, error: 'game not decided' };
  if (newWinner !== a && newWinner !== b) return { ok: false, error: 'winner is not a team in this match' };
  var prev = state.results[key];
  state.results[key] = newWinner;
  state.audit.push({
    actor: actor || 'organizer',
    game: [a, b], prev: prev, winner: newWinner,
    note: 'correction (organizer override)'
  });
  return { ok: true, key: key, prev: prev, winner: newWinner };
}
function resetTournament(state, actor) {
  var entry = {
    id: (state.archives ? state.archives.length : 0) + 1,
    phase: state.phase,
    gamesDecided: nkeys(state.results),
    teams: state.teams.slice(),
    stations: state.stations,
    seed: state.seed,
    schedule: state.schedule,
    results: state.results,
    audit: state.audit.slice()
  };
  var fresh = {
    version: 1,
    phase: 'phase1',
    teams: state.teams.slice(),
    stations: state.stations,
    seed: state.seed,
    schedule: generateSchedule(state.teams.length, state.stations, mulberry32(state.seed)),
    results: {},
    audit: [{ actor: actor || 'organizer', note: 'reset - previous tournament archived #' + entry.id }],
    archives: (state.archives ? state.archives.slice() : []).concat([entry])
  };
  return fresh;
}

/* ---- assertions on a scratch state ---- */
var TEAMS = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P'];
var N = TEAMS.length, STATIONS = 4, SEED = 20261008;
var fails = 0;
function check(cond, msg) { if (!cond) { fails++; WScript.Echo('  FAIL: ' + msg); } }

var st = {
  phase: 'phase1',
  teams: TEAMS.slice(),
  stations: STATIONS,
  seed: SEED,
  schedule: generateSchedule(N, STATIONS, mulberry32(SEED)),
  results: {},
  audit: []
};

// seed one decided game (round 1, station 1) the way a referee would
var p = st.schedule[0][0];
var key = gameKey(p[0], p[1]);
st.results[key] = p[0];
st.audit.push({ actor: 'station R1S1', game: [p[0], p[1]], winner: p[0], note: 'declared' });

// (1) correction of a decided game: succeeds, flips winner, audits prev + new
var c1 = correctResult(st, key, p[0], p[1], p[1], 'organizer');
check(c1.ok === true, 'correction should succeed');
check(c1.prev === p[0], 'correction prev should be the original winner');
check(st.results[key] === p[1], 'correction should change the winner');
var last = st.audit[st.audit.length - 1];
check(last.note === 'correction (organizer override)', 'correction should be audited');
check(last.prev === p[0] && last.winner === p[1], 'correction audit should record prev + new winner');

// (2) foreign-team winner: refused, and it must NOT mutate state
var before = st.results[key], alen = st.audit.length;
var c2 = correctResult(st, key, p[0], p[1], 999, 'x');
check(c2.ok === false && c2.error === 'winner is not a team in this match', 'foreign-team correction must be refused');
check(st.results[key] === before && st.audit.length === alen, 'refused correction must not mutate state');

// (3) correcting an OPEN (undecided) game: refused
var oq = st.schedule[0][1];
var okey = gameKey(oq[0], oq[1]);
check(st.results[okey] === undefined, 'precondition: second station is undecided');
var c3 = correctResult(st, okey, oq[0], oq[1], oq[0], 'x');
check(c3.ok === false && c3.error === 'game not decided', 'open-game correction must be refused');

// (4) start-fresh: archives the finished tournament, then a clean, audited state
var decidedCount = nkeys(st.results);
var auditLen = st.audit.length;
var fresh = resetTournament(st, 'organizer');
check(nkeys(fresh.results) === 0, 'reset should clear results');
check(fresh.phase === 'phase1', 'reset should be phase1');
check(fresh.archives && fresh.archives.length === 1, 'reset should archive the prior tournament');
check(nkeys(fresh.archives[0].results) === decidedCount, 'archived results should be preserved');
check(fresh.archives[0].audit.length === auditLen, 'archived audit trail should be preserved');
check(fresh.archives[0].schedule.length === st.schedule.length, 'archived schedule should be preserved');
check(fresh.audit.length === 1 && fresh.audit[0].note.indexOf('reset') === 0, 'reset should be the first audit entry');
check(fresh.schedule.length === st.schedule.length, 'fresh schedule should regenerate deterministically');

// (5) a SECOND reset stacks on top — history is cumulative, never lost
var fresh2 = resetTournament(fresh, 'organizer');
check(fresh2.archives && fresh2.archives.length === 2, 'second reset should stack the archive');
check(nkeys(fresh2.archives[0].results) === decidedCount, 'first archived entry should still be intact');
check(nkeys(fresh2.archives[1].results) === 0, 'second archived entry should be the empty state');

WScript.Echo('Correction: ' + ((c1.ok === true) && (c2.ok === false) && (c3.ok === false) ? 'PASS' : 'FAIL') +
             '   (decided=changed, foreign=refused, open=refused, prev+new audited)');
WScript.Echo('Reset:      ' + ((fresh.archives && fresh.archives.length === 1) &&
             (fresh2.archives && fresh2.archives.length === 2) &&
             (nkeys(fresh2.archives[0].results) === decidedCount) ? 'PASS' : 'FAIL') +
             '   (archive + clean + audited, cumulative)');
WScript.Echo(fails === 0 ? '== ALL CHECKS PASS ==' : '== ' + fails + ' FAILURE(S) ==');
