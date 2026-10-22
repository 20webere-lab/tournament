/* ES6-aware brace/paren/bracket balance checker for the <script> block of
   tournament.html. JScript (cscript.exe) — no other runtime needed.
   Handles: line/block comments, ' " ` strings (with escapes), template-literal
   ${ ... } expressions (nested templates inside are fine).
   Not a full parser — catches unbalanced delimiters, stray close, unclosed
   strings/templates, and comments swallowing the rest of the file.
   Usage: cscript //nologo syntaxcheck.js <file.html>
   Exits non-zero and prints the first offending line on failure. */

var fso = new ActiveXObject('Scripting.FileSystemObject');
var f = fso.openTextFile(WScript.Arguments(0), 1);
var src = f.readAll();
f.close();

var m = /<script>([\s\S]*)<\/script>/.exec(src);
if (!m) { WScript.Echo('FAIL: no <script>...</script> block found'); WScript.Quit(1); }
var s = m[1];
var len = s.length, i = 0;

var line = 1;
function at(n) { return s.charAt(n); }
function lineOf(idx) {
  var l = 1;
  for (var k = 0; k < idx && k < len; k++) if (s.charAt(k) === '\n') l++;
  return l;
}
function fail(what, idx) { WScript.Echo('FAIL: ' + what + ' at line ' + lineOf(idx)); WScript.Quit(1); }

var stack = [{ kind: 'code', d: 0 }];
while (i < len) {
  var c = at(i);
  var top = stack[stack.length - 1];
  if (top.kind === 'tpl') {
    if (c === '\\') { i += 2; continue; }
    if (c === '`') { stack.pop(); i++; continue; }
    if (c === '$' && i + 1 < len && at(i + 1) === '{') {
      stack.push({ kind: 'code', d: 1 }); i += 2; continue;
    }
    if (c === '\n') line++;
    i++; continue;
  }
  // code context
  if (c === '/' && i + 1 < len && at(i + 1) === '/') {
    while (i < len && at(i) !== '\n') i++;
    continue;
  }
  if (c === '/' && i + 1 < len && at(i + 1) === '*') {
    i += 2;
    while (i < len && !(at(i) === '*' && i + 1 < len && at(i + 1) === '/')) {
      if (at(i) === '\n') line++;
      i++;
    }
    if (i >= len) fail('unclosed block comment', i - 1);
    i += 2; continue;
  }
  if (c === "'" || c === '"') {
    var q = c; i++;
    while (i < len && at(i) !== q && at(i) !== '\n') { if (at(i) === '\\') i++; i++; }
    if (i >= len || at(i) !== q) fail('unterminated ' + q + ' string', i);
    i++; continue;
  }
  if (c === '`') { stack.push({ kind: 'tpl' }); i++; continue; }
  if (c === '{') { top.d++; top.opens = top.opens || []; top.opens.push(i); i++; continue; }
  if (c === '}') {
    top.d--;
    if (top.d < 0) fail('stray } (more closes than opens)', i);
    if (top.opens) top.opens.pop();
    if (top.d === 0 && stack.length > 1) stack.pop(); // closes a ${ ... }
    i++; continue;
  }
  if (c === '(') { top.p = (top.p || 0) + 1; i++; continue; }
  if (c === ')') { top.p = (top.p || 1) - 1; if (top.p < 0) fail('stray )', i); i++; continue; }
  if (c === '[') { top.b = (top.b || 0) + 1; i++; continue; }
  if (c === ']') { top.b = (top.b || 1) - 1; if (top.b < 0) fail('stray ]', i); i++; continue; }
  if (c === '\n') line++;
  i++;
}
var root = stack[0];
if (stack.length !== 1) fail(stack.length - 1 + ' unclosed template literal(s)', len);
if (root.d !== 0) {
  var leftover = root.opens && root.opens.length ? root.opens[0] : null;
  fail('brace imbalance: ' + root.d + ' unclosed { (last opened at line ' +
       (leftover != null ? lineOf(leftover) : '?') + ')', len);
}
if ((root.p || 0) !== 0) fail('paren imbalance: ' + root.p + ' unclosed (', len);
if ((root.b || 0) !== 0) fail('bracket imbalance: ' + root.b + ' unclosed [', len);

WScript.Echo('PASS: delimiters balanced (' + (len) + ' chars of script, ' + line + ' lines)');
