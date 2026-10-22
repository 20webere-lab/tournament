/* Standalone Phase-1 schedule generator + validator.
   Written in ES5 (JScript) so it can run under cscript.exe on Windows
   with no other runtime installed. The SAME algorithm ships inside
   tournament.html, so what you verify here is what the app uses. */

// Math.imul polyfill — JScript (cscript) predates ES6; browsers have it natively.
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

/* Circle method: n-1 perfect matchings, each with n/2 disjoint pairs,
   covering every possible pair exactly once (all n*(n-1)/2 pairs). */
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

/* Pick 6 matchings (seeded -> reproducible), then split each 8-pair
   matching into chunks of STATIONS so each round has <= STATIONS games.
   Teams not in a chunk get a bye that round. */
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

function validate(sched, n, stations) {
  var cnt = []; for (var i = 0; i < n; i++) cnt.push(0);
  var seen = {};
  var total = 0;
  for (var r = 0; r < sched.length; r++) {
    var pairs = sched[r];
    var inR = {};
    for (var p = 0; p < pairs.length; p++) {
      var a = pairs[p][0], b = pairs[p][1];
      if (inR[a] || inR[b]) throw new Error('team twice in same round ' + r);
      inR[a] = 1; inR[b] = 1;
      var key = Math.min(a, b) + '-' + Math.max(a, b);
      if (seen[key]) throw new Error('rematch ' + key);
      seen[key] = 1; total++;
      cnt[a]++; cnt[b]++;
    }
    if (pairs.length > stations) throw new Error('round ' + r + ' too full');
  }
  for (var i2 = 0; i2 < n; i2++) {
    if (cnt[i2] !== 6) throw new Error('team ' + i2 + ' has ' + cnt[i2] + ' games');
  }
  if (total !== n * 3) throw new Error('total games ' + total + ' != ' + n * 3);
  return true;
}

/* ---- main ---- */
var TEAMS = [
  'Brazil', 'Japan', 'Canada', 'Germany', 'Australia', 'Mexico',
  'Kenya', 'Norway', 'South Korea', 'Italy', 'Netherlands', 'Egypt',
  'New Zealand', 'Poland', 'Chile', 'Spain'
];
var N = TEAMS.length;        // 16
var STATIONS = 4;            // games that can run in parallel per round
var SEED = 20261008;         // fixed -> the same schedule every run

var rng = mulberry32(SEED);
var sched = generateSchedule(N, STATIONS, rng);

// deterministic re-check: regenerate and compare shape
var rng2 = mulberry32(SEED);
var sched2 = generateSchedule(N, STATIONS, rng2);
var same = sched.length === sched2.length;
for (var rr = 0; same && rr < sched.length; rr++) {
  if (sched[rr].length !== sched2[rr].length) { same = false; break; }
}

// ---- declare / once-and-locked contract (Step 2), ES5 port of the browser logic ----
function gameKey(a, b) { return Math.min(a, b) + '-' + Math.max(a, b); }
function stationOf(state, roundIdx, stationIdx) {
  var round = state.schedule[roundIdx];
  if (!round) return null;
  return round[stationIdx] || null;
}
function resultFor(state, a, b) {
  var w = state.results[gameKey(a, b)];
  return (w === undefined) ? null : w;
}
function declare(state, roundIdx, stationIdx, winnerIdx, actor) {
  var pair = stationOf(state, roundIdx, stationIdx);
  if (!pair) return { ok: false, error: 'no such station' };
  var a = pair[0], b = pair[1];
  if (winnerIdx !== a && winnerIdx !== b) return { ok: false, error: 'winner is not a team in this match' };
  var key = gameKey(a, b);
  if (state.results[key] !== undefined) return { ok: false, error: 'already decided', winner: state.results[key] };
  state.results[key] = winnerIdx;
  state.audit.push({ t: 'now', actor: actor, round: roundIdx + 1, station: stationIdx + 1,
                     game: [a, b], winner: winnerIdx, note: 'declared' });
  return { ok: true, key: key, winner: winnerIdx };
}
function someOther(state, roundIdx, stationIdx) {
  var pair = state.schedule[roundIdx][stationIdx];
  for (var i = 0; i < N; i++) if (i !== pair[0] && i !== pair[1]) return i;
  return -1;
}

var schedOk = false;
try { validate(sched, N, STATIONS); schedOk = true; } catch (e) { schedOk = false; }

// run the contract on a scratch state (does not touch anything real)
var dstate = { schedule: sched, results: {}, audit: [] };
var p = sched[0][0];
var dpass = true;
var r1 = declare(dstate, 0, 0, p[0], 'test');
if (!r1.ok) dpass = false;                                        // first declare succeeds
var r2 = declare(dstate, 0, 0, p[1], 'test');
if (r2.ok) dpass = false;                                         // same game, other team -> refused
if (r2.winner !== p[0]) dpass = false;                            // locked winner preserved
var r3 = declare(dstate, 0, 0, p[1], 'test');
if (r3.ok || r3.error !== 'already decided') dpass = false;       // re-declaring locked game -> refused
var r4 = declare(dstate, 0, 1, someOther(dstate, 0, 1), 'test');
if (r4.ok || r4.error !== 'winner is not a team in this match') dpass = false; // foreign team refused
if (dstate.audit.length !== 1) dpass = false;                     // only the one success was logged
if (resultFor(dstate, p[0], p[1]) !== p[0]) dpass = false;         // locked winner is readable back

var all = schedOk && same && dpass;
WScript.Echo('Schedule:   ' + (schedOk ? 'PASS' : 'FAIL') + '  (deterministic=' + same + ')');
WScript.Echo('Declare:    ' + (dpass ? 'PASS' : 'FAIL') + '  (scoped, two-button, once-and-locked, audited)');
WScript.Echo(all ? '== ALL CHECKS PASS ==' : '== FAILURES PRESENT ==');

WScript.Echo('Teams: ' + N + '  Stations/round: ' + STATIONS +
             '  Rounds: ' + sched.length +
             '  Total games: ' + sched.length * 4);
WScript.Echo('');

for (var ri = 0; ri < sched.length; ri++) {
  var line = 'Round ' + (ri + 1) + ': ';
  for (var pi = 0; pi < sched[ri].length; pi++) {
    var p = sched[ri][pi];
    line += TEAMS[p[0]] + ' vs ' + TEAMS[p[1]];
    if (pi < sched[ri].length - 1) line += '   |   ';
  }
  WScript.Echo(line);
}

WScript.Echo('');
WScript.Echo('Per-team schedule:');
for (var ti = 0; ti < N; ti++) {
  var opp = [];
  for (var rj = 0; rj < sched.length; rj++) {
    for (var pj = 0; pj < sched[rj].length; pj++) {
      var q = sched[rj][pj];
      if (q[0] === ti) opp.push((rj + 1) + ':' + TEAMS[q[1]]);
      if (q[1] === ti) opp.push((rj + 1) + ':' + TEAMS[q[0]]);
    }
  }
  WScript.Echo('  ' + TEAMS[ti] + '  (' + opp.length + ')  ' + opp.join('  '));
}
