/* Standalone Step-4 verifier: qualification, tiebreak, knockout, phase flow.
   ES5 (JScript) so it runs under cscript.exe with no other runtime installed.
   Mirrors the SAME pure functions shipped in tournament.html
   (phase1Decided / qualification / advancement / declareMatch / bracket /
   currentPhase), so what you verify here is what the app uses. */

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
  return rounds;
}
function generateSchedule(n, stations, rng) {
  var all = circleRounds(n);
  var idx = shuffle(function (s) { var o = []; for (var i = 0; i < s.length; i++) o.push(i); return o; }(all), rng).slice(0, 6);
  var chosen = []; for (var c = 0; c < idx.length; c++) chosen.push(all[idx[c]]);
  var size = Math.max(1, stations);
  var chunks = [];
  for (var m = 0; m < chosen.length; m++) {
    for (var s2 = 0; s2 < chosen[m].length; s2 += size) chunks.push(chosen[m].slice(s2, s2 + size));
  }
  var per = Math.ceil((n / 2) / size);
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
function inArr(arr, v) { for (var i = 0; i < arr.length; i++) if (arr[i] === v) return true; return false; }
function gameKey(a, b) { return Math.min(a, b) + '-' + Math.max(a, b); }

/* ---- mirrors of the shipped core (ES5) ---- */
function standings(state) {
  var n = state.teams.length, rows = [];
  for (var i = 0; i < n; i++) rows.push({ idx: i, played: 0, wins: 0, losses: 0, pts: 0 });
  var keys = []; for (var k in state.results) keys.push(k);
  for (var j = 0; j < keys.length; j++) {
    var key = keys[j];
    if (!/^\d+-\d+$/.test(key)) continue;   // only base games; ignore tb-/ko- keys
    var w = state.results[key];
    var parts = key.split('-');
    var a = Number(parts[0]), b = Number(parts[1]);
    var l = (w === a) ? b : a;   // loser is the other team (mirror of shipped fix)
    if (rows[w]) { rows[w].played++; rows[w].wins++; rows[w].pts += 1; }
    if (rows[l]) { rows[l].played++; rows[l].losses++; }
  }
  rows.sort(function (x, y) { return (y.pts - x.pts) || (x.idx - y.idx); });
  return rows;
}
function phase1Decided(state) {
  var done = 0, total = 0;
  for (var r = 0; r < state.schedule.length; r++) {
    var round = state.schedule[r];
    for (var p = 0; p < round.length; p++) {
      total++;
      if (state.results[gameKey(round[p][0], round[p][1])] !== undefined) done++;
    }
  }
  return { done: done, total: total, complete: done === total };
}
function qualification(state) {
  var rows = standings(state);
  var line = rows[7].pts;
  var above = [], onLine = [];
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].pts > line) above.push(rows[i]);
    else if (rows[i].pts === line) onLine.push(rows[i]);
  }
  var open = 8 - above.length;
  if (onLine.length <= open) {
    var plain = [];
    for (var pa = 0; pa < above.length; pa++) plain.push(above[pa].idx);
    for (var po = 0; po < onLine.length; po++) plain.push(onLine[po].idx);
    return { advanced: plain, tiebreak: null, line: line };
  }
  var tiebreak = onLine.slice(0, 2);
  var spill = onLine.slice(2);
  var out = { advanced: [], tiebreak: [tiebreak[0].idx, tiebreak[1].idx], line: line };
  for (var a = 0; a < above.length; a++) out.advanced.push(above[a].idx);
  var sp = Math.max(0, open - 1);
  for (var s = 0; s < sp && s < spill.length; s++) out.advanced.push(spill[s].idx);
  return out;
}
function tiebreakKey(a, b) { return 'tb-' + gameKey(a, b); }
function advancement(state) {
  var q = qualification(state);
  function ranked(set) {
    var rows = standings(state), out = [];
    for (var i = 0; i < rows.length; i++) if (inArr(set, rows[i].idx)) out.push(rows[i].idx);
    return out;
  }
  if (!q.tiebreak) return { advanced: ranked(q.advanced), resolved: true };
  var key = tiebreakKey(q.tiebreak[0], q.tiebreak[1]);
  var w = state.results[key];
  if (w === undefined) return { advanced: null, resolved: false, tiebreak: q.tiebreak, key: key };
  var combined = q.advanced.slice(); combined.push(w);
  return { advanced: ranked(combined), resolved: true };
}
function declareMatch(state, key, a, b, winnerIdx, actor, label) {
  if (a == null || b == null) return { ok: false, error: 'match not set yet — earlier round undecided' };
  if (winnerIdx !== a && winnerIdx !== b) return { ok: false, error: 'winner is not a team in this match' };
  if (state.results[key] !== undefined) return { ok: false, error: 'already decided', winner: state.results[key] };
  state.results[key] = winnerIdx;
  state.audit.push({ t: 'now', actor: actor || 'referee', game: [a, b], winner: winnerIdx,
                     note: 'declared' + (label ? ' — ' + label : '') });
  return { ok: true, key: key, winner: winnerIdx };
}
function bracket(state) {
  var adv = advancement(state);
  if (!adv.advanced) return null;
  var A = adv.advanced;
  function winOf(m) { return (state.results[m.key] !== undefined) ? state.results[m.key] : null; }
  function mk(r, m, a, b) { return { key: 'ko-r' + r + 'm' + m, r: r, m: m, a: a, b: b }; }
  var qf = [mk(1, 1, A[0], A[7]), mk(1, 2, A[1], A[6]), mk(1, 3, A[2], A[5]), mk(1, 4, A[3], A[4])];
  var sf = [mk(2, 1, winOf(qf[0]), winOf(qf[1])), mk(2, 2, winOf(qf[2]), winOf(qf[3]))];
  var fin = [mk(3, 1, winOf(sf[0]), winOf(sf[1]))];
  return { rounds: [qf, sf, fin] };
}
function currentPhase(state) {
  var p1 = phase1Decided(state);
  if (!p1.complete) return { phase: 'phase1', p1: p1 };
  var adv = advancement(state);
  if (!adv.resolved) return { phase: 'tiebreak', p1: p1, tiebreak: adv.tiebreak, key: adv.key };
  var bk = bracket(state);
  var finalM = bk.rounds[2][0];
  var champ = (state.results[finalM.key] !== undefined) ? state.results[finalM.key] : null;
  return { phase: (champ !== null) ? 'done' : 'phase2', p1: p1, champion: champ, bracket: bk };
}

/* ---- assertions ---- */
var TEAMS = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P'];
var N = TEAMS.length, STATIONS = 4, SEED = 20261008;
var fails = 0;
function check(cond, msg) { if (!cond) { fails++; WScript.Echo('  FAIL: ' + msg); } }

function freshState() {
  return {
    phase: 'phase1', teams: TEAMS.slice(), stations: STATIONS, seed: SEED,
    schedule: generateSchedule(N, STATIONS, mulberry32(SEED)),
    results: {}, audit: []
  };
}
function finishPhase1(s) {
  for (var r = 0; r < s.schedule.length; r++)
    for (var p = 0; p < s.schedule[r].length; p++) {
      var pair = s.schedule[r][p];
      s.results[gameKey(pair[0], pair[1])] = pair[0];
    }
}

// (1) fresh state: phase1, nothing decided
var st = freshState();
var p0 = phase1Decided(st);
check(p0.done === 0 && p0.total === 48 && p0.complete === false, 'fresh: 0/48 decided');
check(currentPhase(st).phase === 'phase1', 'fresh: phase should be phase1');
check(bracket(st) === null, 'fresh: no bracket before phase 1 completes');

// (2) phase-1 complete: qualification resolves (tiebreak or not)
var s2 = freshState(); finishPhase1(s2);
var q2 = qualification(s2);
var std = standings(s2);
var line = std[7].pts;
var above = [], onLine = [];
for (var i = 0; i < std.length; i++) {
  if (std[i].pts > line) above.push(std[i].idx);
  else if (std[i].pts === line) onLine.push(std[i].idx);
}
var needTb = (onLine.length > 8 - above.length);
check((q2.tiebreak !== null) === needTb, 'qual: tiebreak required iff more on-line teams than open slots');
if (needTb) {
  check(q2.tiebreak[0] === onLine[0] && q2.tiebreak[1] === onLine[1],
        'qual: tiebreak = two highest-seeded on-line teams');
  check(q2.advanced.length === 7, 'qual: 7 auto-advance + 1 tiebreak slot');
  check(!inArr(q2.advanced, onLine[0]) && !inArr(q2.advanced, onLine[1]),
        'qual: tiebreak teams must not auto-advance');
} else {
  check(q2.advanced.length === 8, 'qual: exactly 8 advance with no tiebreak');
  var expect = above.slice(); for (var o = 0; o < onLine.length; o++) expect.push(onLine[o]);
  check(q2.advanced.slice().sort().join(',') === expect.slice().sort().join(','),
        'qual: advanced = above + on-line (no tiebreak case)');
}

// (3) full walk with tiebreak forced on a scratch distribution:
//     fabricate 7 above the line, 2 on it, 1 slot open (the common case).
function forceDistribution(s) {
  // 48 games, 48 points. Give teams 0..6 -> 4 wins each (28),
  // teams 7,8 (on-line) -> 3 wins each (6), teams 9..15 -> 2 wins each (14). 28+6+14=48.
  var wins = [4,4,4,4,4,4,4,3,3,2,2,2,2,2,2,2];
  // Flatten the 48 games, then try randomized greedy orderings (seeded -> reproducible):
  // pick the winner of each game = the side still needing wins (bigger need first).
  // A single fixed order can starve a team; retrying with shuffled orders finds one that
  // realizes the target vector. First success wins; deterministic for a fixed seed.
  var games = [];
  for (var r = 0; r < s.schedule.length; r++)
    for (var p = 0; p < s.schedule[r].length; p++) games.push(s.schedule[r][p]);
  var ok = null;
  for (var att = 0; att < 500 && ok === null; att++) {
    var order = shuffle(games, mulberry32(1000 + att));
    var need = wins.slice();
    var res = {};
    var good = true;
    for (var g = 0; g < order.length; g++) {
      var a = order[g][0], b = order[g][1];
      var w;
      if (need[a] <= 0) w = b;
      else if (need[b] <= 0) w = a;
      else if (need[a] >= need[b]) w = a;
      else w = b;
      need[w]--;
      res[gameKey(a, b)] = w;
    }
    for (var t = 0; t < N; t++) if (need[t] !== 0) { good = false; break; }
    if (good) ok = res;
  }
  if (ok === null) throw new Error('fabrication failed: no ordering realized the target');
  s.results = ok;
  var rows = standings(s);
  for (var t2 = 0; t2 < N; t2++) {
    var row = null; for (var x = 0; x < rows.length; x++) if (rows[x].idx === t2) row = rows[x];
    if (row.pts !== wins[t2]) throw new Error('fabricated pts wrong for team ' + t2 + ': got ' + row.pts);
  }
}

var s3 = freshState(); forceDistribution(s3);
var q3 = qualification(s3);
check(q3.tiebreak && q3.tiebreak.length === 2, 'forced: a 2-team tiebreak is required');
check(q3.advanced.length === 7, 'forced: 7 auto-advance');
var tA = q3.tiebreak[0], tB = q3.tiebreak[1];

// pending: no bracket, phase = tiebreak
check(currentPhase(s3).phase === 'tiebreak', 'pending: phase should be tiebreak');
check(bracket(s3) === null, 'pending: no bracket while tiebreak undecided');

// declare the tiebreak (winner = second-listed team), locked on second call
var tkey = tiebreakKey(tA, tB);
var d1 = declareMatch(s3, tkey, tA, tB, tB, 'tools');
check(d1.ok === true, 'tiebreak declare should succeed');
var d2 = declareMatch(s3, tkey, tA, tB, tA, 'tools');
check(d2.ok === false && d2.error === 'already decided' && d2.winner === tB,
      'tiebreak must be once-and-locked');
var d3 = declareMatch(s3, tkey, tA, tB, 99, 'tools');
check(d3.ok === false && d3.error === 'winner is not a team in this match',
      'tiebreak foreign-team winner refused');
check(s3.audit.length === 1, 'only the one successful declare is audited');

// bracket appears with QF seeds 1v8..4v5 in rank order
var bk = bracket(s3);
var A8 = advancement(s3).advanced;
check(A8.length === 8, 'advancement: exactly 8 teams after tiebreak');
check(inArr(A8, tB), 'advancement: tiebreak winner is in the 8');
check(!inArr(A8, tA), 'advancement: tiebreak loser is out');
check(bk.rounds[0][0].a === A8[0] && bk.rounds[0][0].b === A8[7], 'QF1 = 1v8');
check(bk.rounds[0][1].a === A8[1] && bk.rounds[0][1].b === A8[6], 'QF2 = 2v7');
check(bk.rounds[0][2].a === A8[2] && bk.rounds[0][2].b === A8[5], 'QF3 = 3v6');
check(bk.rounds[0][3].a === A8[3] && bk.rounds[0][3].b === A8[4], 'QF4 = 4v5');
check(bk.rounds[1][0].a === null && bk.rounds[1][1].b === null, 'SF TBC before QF decides');

// walk to a champion
var QF = bk.rounds[0];
var wQF = [QF[0].a, QF[1].a, QF[2].b, QF[3].b];
for (var m = 0; m < 4; m++) {
  var rr = declareMatch(s3, QF[m].key, QF[m].a, QF[m].b, wQF[m], 'tools');
  if (!rr.ok) throw new Error('QF declare failed: ' + rr.error);
}
var SF = bracket(s3).rounds[1];
check(SF[0].a === wQF[0] && SF[0].b === wQF[1], 'SF1 = winners of QF1+QF2');
check(SF[1].a === wQF[2] && SF[1].b === wQF[3], 'SF2 = winners of QF3+QF4');
var wSF = [SF[0].b, SF[1].a];
for (var m2 = 0; m2 < 2; m2++) {
  var rr2 = declareMatch(s3, SF[m2].key, SF[m2].a, SF[m2].b, wSF[m2], 'tools');
  if (!rr2.ok) throw new Error('SF declare failed: ' + rr2.error);
}
var FIN = bracket(s3).rounds[2][0];
check(FIN.a === wSF[0] && FIN.b === wSF[1], 'final = winners of SF1+SF2');
var fr = declareMatch(s3, FIN.key, FIN.a, FIN.b, FIN.b, 'tools');
check(fr.ok === true, 'final declare should succeed');
var ph = currentPhase(s3);
check(ph.phase === 'done' && ph.champion === FIN.b, 'champion recorded');

// (4) referee guard: TBC match cannot be declared
var d4 = declareMatch(s3, 'ko-r9m9', null, null, 0, 'x');
check(d4.ok === false && d4.error.indexOf('not set') !== -1, 'TBC match declare must be refused');

// (5) standings must ignore namespaced tb-/ko- keys (no phantom points)
var s5 = freshState(); finishPhase1(s5);
var basePts = standings(s5);
s5.results[tiebreakKey(0, 1)] = 0;           // namespaced extra "result"
s5.results['ko-r1m1'] = 1;                    // namespaced extra "result"
var afterPts = standings(s5);
var same = basePts.length === afterPts.length;
for (var t3 = 0; same && t3 < N; t3++) {
  var rb = null, ra = null;
  for (var x2 = 0; x2 < basePts.length; x2++) if (basePts[x2].idx === t3) rb = basePts[x2];
  for (var x3 = 0; x3 < afterPts.length; x3++) if (afterPts[x3].idx === t3) ra = afterPts[x3];
  if (rb.pts !== ra.pts || rb.played !== ra.played) same = false;
}
check(same, 'standings must ignore tb-/ko- result keys');

WScript.Echo('Phase-flow: ' + (p0.complete === false && currentPhase(st).phase === 'phase1' ? 'PASS' : 'FAIL') +
             '   (fresh -> phase1, no bracket)');
WScript.Echo('Qual:       ' + (((q2.tiebreak !== null) === needTb) ? 'PASS' : 'FAIL') +
             '   (' + (needTb ? 'seed had an on-line tie' : 'seed had a clean split') +
             ' line=' + line + 'pts, on-line=' + onLine.length + ')');
WScript.Echo('Tiebreak:   ' + (d1.ok && d2.ok === false && d3.ok === false ? 'PASS' : 'FAIL') +
             '   (two teams, once-and-locked, foreign refused, audited)');
WScript.Echo('Knockout:   ' + (fr.ok && ph.phase === 'done' && d4.ok === false ? 'PASS' : 'FAIL') +
             '   (QF 1v8..4v5, SF/final feed, champion, TBC refused)');
WScript.Echo('Namespacing:' + (same ? 'PASS' : 'FAIL') + '   (tb-/ko- keys never count as points)');
WScript.Echo(fails === 0 ? '== ALL CHECKS PASS ==' : '== ' + fails + ' FAILURE(S) ==');
