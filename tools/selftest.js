/* ES5 (JScript) port of the browser selfTest's Step-4 section (tournament.html
   lines ~860-937), so we can reproduce the reported "QF declare should succeed:
   match not set yet" failure under cscript with no other runtime installed.
   Core functions are COPIES of the ones shipped in tournament.html (ES5 form),
   same as knockout.js. Run: cscript //nologo selftest.js <file.html>
   (reads the shipped core from the HTML and re-implies the self-test around it
   — but JScript can't eval ES6, so instead we mirror the core here and assert
   it is textually identical to the shipped core where it matters.) */

// ---- core (ES5 mirrors of tournament.html lines 550-698) ----
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
  var idx = []; for (var i = 0; i < all.length; i++) idx.push(i);
  idx = shuffle(idx, rng);
  var chosen = []; for (var c = 0; c < 6; c++) chosen.push(all[idx[c]]);
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
function gameKey(a, b) { return Math.min(a, b) + '-' + Math.max(a, b); }
function inArr(arr, v) { for (var i = 0; i < arr.length; i++) if (arr[i] === v) return true; return false; }

function standings(state) {
  var n = state.teams.length, rows = [];
  for (var i = 0; i < n; i++) rows.push({ idx: i, played: 0, wins: 0, losses: 0, pts: 0 });
  var keys = []; for (var k in state.results) keys.push(k);
  for (var j = 0; j < keys.length; j++) {
    var key = keys[j];
    if (!/^\d+-\d+$/.test(key)) continue;
    var w = state.results[key];
    var parts = key.split('-');
    var a = Number(parts[0]), b = Number(parts[1]);
    var l = (w === a) ? b : a;
    if (rows[w]) { rows[w].played++; rows[w].wins++; rows[w].pts += 1; }
    if (rows[l]) { rows[l].played++; rows[l].losses++; }
  }
  rows.sort(function (x, y) { return (y.pts - x.pts) || (x.idx - y.idx); });
  return rows;
}
function phase1Decided(state) {
  var done = 0, total = 0;
  for (var r = 0; r < state.schedule.length; r++) {
    for (var p = 0; p < state.schedule[r].length; p++) {
      total++;
      if (state.results[gameKey(state.schedule[r][p][0], state.schedule[r][p][1])] !== undefined) done++;
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
  var tiebreak = [onLine[0].idx, onLine[1].idx];
  var spill = onLine.slice(2);
  var adv = [];
  for (var am = 0; am < above.length; am++) adv.push(above[am].idx);
  var sp = Math.max(0, open - 1);
  for (var sm = 0; sm < sp && sm < spill.length; sm++) adv.push(spill[sm].idx);
  return { advanced: adv, tiebreak: tiebreak, line: line };
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
  return { advanced: ranked(q.advanced.concat([w])), resolved: true };
}
function declareMatch(state, key, a, b, winnerIdx, actor, label) {
  if (a == null || b == null) return { ok: false, error: 'match not set yet — earlier round undecided' };
  if (winnerIdx !== a && winnerIdx !== b) return { ok: false, error: 'winner is not a team in this match' };
  if (state.results[key] !== undefined) return { ok: false, error: 'already decided', winner: state.results[key] };
  state.results[key] = winnerIdx;
  state.audit.push({ t: 'now', actor: actor || 'referee', game: [a, b], winner: winnerIdx, note: 'declared' });
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
function correctResult(state, key, a, b, newWinner, actor) {
  if (state.results[key] === undefined) return { ok: false, error: 'game not decided' };
  if (newWinner !== a && newWinner !== b) return { ok: false, error: 'winner is not a team in this match' };
  var prev = state.results[key];
  state.results[key] = newWinner;
  state.audit.push({ t: 'now', actor: actor || 'organizer', game: [a, b], prev: prev, winner: newWinner, note: 'correction (organizer override)' });
  return { ok: true, key: key, prev: prev, winner: newWinner };
}

// ---- the self-test flow (browser selfTest section 6, ported 1:1) ----
var TEAMS = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P'];
var SEED = 20261008, STATIONS = 4;
var fails = 0;
function check(cond, msg) { if (!cond) { fails++; WScript.Echo('  FAIL: ' + msg); } }

function freshState() {
  return {
    phase: 'phase1', teams: TEAMS.slice(), stations: STATIONS, seed: SEED,
    schedule: generateSchedule(TEAMS.length, STATIONS, mulberry32(SEED)),
    results: {}, audit: []
  };
}
function finishPhase1(s) {
  for (var r = 0; r < s.schedule.length; r++)
    for (var p = 0; p < s.schedule[r].length; p++) {
      var a = s.schedule[r][p][0], b = s.schedule[r][p][1];
      s.results[gameKey(a, b)] = a;
    }
}

var s6 = freshState();
finishPhase1(s6);

var std6 = standings(s6);
var line6 = std6[7].pts;
var onLine6 = []; var above6 = [];
for (var i = 0; i < std6.length; i++) {
  if (std6[i].pts === line6) onLine6.push(std6[i]);
  if (std6[i].pts > line6) above6.push(std6[i]);
}
var q6 = qualification(s6);
WScript.Echo('Seed distribution: line=' + line6 + ' pts, above=' + above6.length + ', on-line=' + onLine6.length +
             ', tiebreak=' + (q6.tiebreak ? q6.tiebreak.join('v') : 'none'));

if (onLine6.length > 8 - above6.length) {
  if (!q6.tiebreak || q6.tiebreak.length !== 2) { fails++; WScript.Echo('  FAIL: qual: expected a 2-team tiebreak'); }
  var ta = q6.tiebreak[0], tb = q6.tiebreak[1];
  if (q6.tiebreak[0] !== onLine6[0].idx || q6.tiebreak[1] !== onLine6[1].idx) { fails++; WScript.Echo('  FAIL: qual: tiebreak must be the two highest-seeded on-line teams'); }
  if (q6.advanced.length !== 7) { fails++; WScript.Echo('  FAIL: qual: 7 auto-advance + 1 tiebreak slot'); }
  if (inArr(q6.advanced, ta) || inArr(q6.advanced, tb)) { fails++; WScript.Echo('  FAIL: qual: tiebreak teams must not auto-advance'); }
  if (currentPhase(s6).phase !== 'tiebreak') { fails++; WScript.Echo('  FAIL: phase should be tiebreak'); }
  if (bracket(s6) !== null) { fails++; WScript.Echo('  FAIL: bracket must be null while tiebreak is pending'); }
  var tr = declareMatch(s6, tiebreakKey(ta, tb), ta, tb, tb, 'selftest-ref');
  if (!tr.ok) { fails++; WScript.Echo('  FAIL: tiebreak declare should succeed: ' + tr.error); }
  if (declareMatch(s6, tiebreakKey(ta, tb), ta, tb, ta, 'x').error !== 'already decided') { fails++; WScript.Echo('  FAIL: tiebreak must be once-and-locked'); }
  var adv = advancement(s6).advanced;
  WScript.Echo('Advancement resolved: ' + (adv ? adv.join(',') : 'NULL') + ' (length ' + (adv ? adv.length : '-') + ')');
  var bk6 = bracket(s6);
  var A = bk6.rounds[0];
  if (A.length !== 4) { fails++; WScript.Echo('  FAIL: QF must have 4 matches'); }
  var qfStr = [];
  for (var qd = 0; qd < A.length; qd++) {
    qfStr.push((A[qd].a == null ? 'TBC' : A[qd].a) + ' vs ' + (A[qd].b == null ? 'TBC' : A[qd].b));
  }
  WScript.Echo('QF: ' + qfStr.join('   |   '));
  if (!(A[0].a === adv[0] && A[0].b === adv[7] && A[1].a === adv[1] && A[1].b === adv[6]
      && A[2].a === adv[2] && A[2].b === adv[5] && A[3].a === adv[3] && A[3].b === adv[4])) { fails++; WScript.Echo('  FAIL: QF seedings must be 1v8 2v7 3v6 4v5'); }
  if (bk6.rounds[1].length !== 2 && bk6.rounds[2].length !== 1) { fails++; WScript.Echo('  FAIL: bracket shape wrong'); }
  if (bk6.rounds[1][0].a !== null) { fails++; WScript.Echo('  FAIL: SF must be TBC before QF decides'); }
  var wQF = [A[0].a, A[1].a, A[2].b, A[3].b];
  for (var qi = 0; qi < A.length; qi++) {
    var r = declareMatch(s6, A[qi].key, A[qi].a, A[qi].b, wQF[qi], 'selftest-ref');
    if (!r.ok) { fails++; WScript.Echo('  FAIL: QF declare should succeed: ' + r.error); }
  }
  var SF = bracket(s6).rounds[1];
  if (!(SF[0].a === wQF[0] && SF[0].b === wQF[1] && SF[1].a === wQF[2] && SF[1].b === wQF[3])) { fails++; WScript.Echo('  FAIL: SF must take winners of (QF1,QF2) and (QF3,QF4)'); }
  var wSF = [SF[0].b, SF[1].a];
  for (var si = 0; si < 2; si++) {
    var rs = declareMatch(s6, SF[si].key, SF[si].a, SF[si].b, wSF[si], 'selftest-ref');
    if (!rs.ok) { fails++; WScript.Echo('  FAIL: SF declare should succeed: ' + rs.error); }
  }
  var FIN = bracket(s6).rounds[2][0];
  if (!(FIN.a === wSF[0] && FIN.b === wSF[1])) { fails++; WScript.Echo('  FAIL: final must take SF winners'); }
  var fr = declareMatch(s6, FIN.key, FIN.a, FIN.b, FIN.b, 'selftest-ref');
  if (!fr.ok) { fails++; WScript.Echo('  FAIL: final declare should succeed: ' + fr.error); }
  var ph = currentPhase(s6);
  if (ph.phase !== 'done' || ph.champion !== FIN.b) { fails++; WScript.Echo('  FAIL: champion not recorded'); }
  var flip = correctResult(s6, FIN.key, FIN.a, FIN.b, FIN.a, 'selftest-organizer');
  if (!flip.ok) { fails++; WScript.Echo('  FAIL: final correction should succeed'); }
  if (currentPhase(s6).champion !== FIN.a) { fails++; WScript.Echo('  FAIL: correction must re-flow the champion'); }
  var la = s6.audit[s6.audit.length - 1];
  if (la.prev !== FIN.b || la.winner !== FIN.a) { fails++; WScript.Echo('  FAIL: final correction must audit prev + new'); }
  if (declareMatch(s6, 'ko-r9m9', null, null, 0, 'x').error.indexOf('not set') === -1) { fails++; WScript.Echo('  FAIL: TBC match declare must be refused'); }
} else {
  if (q6.tiebreak) { fails++; WScript.Echo('  FAIL: qual: should not need a tiebreak'); }
  if (q6.advanced.length !== 8) { fails++; WScript.Echo('  FAIL: qual: advanced should be exactly 8'); }
  var top8 = []; for (var t8 = 0; t8 < 8; t8++) top8.push(std6[t8].idx);
  var advS = q6.advanced.slice();
  top8.sort(function (a, b) { return a - b; });
  advS.sort(function (a, b) { return a - b; });
  if (advS.join(',') !== top8.join(',')) { fails++; WScript.Echo('  FAIL: qual: advanced set should be the top-8 ranked'); }
}

WScript.Echo(fails === 0 ? '== ALL CHECKS PASS ==' : '== ' + fails + ' FAILURE(S) ==');
