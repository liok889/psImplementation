// Headless validation: run the JavaScript analysis on the shared fixture and
// compare every extracted statistic against the C++ reference (ref_stats.json).
// Designed for JavaScriptCore's `jsc` shell. Run from the project root:
//   jsc test/run_validation.js
'use strict';

load("web/js/fft.js");
load("web/js/filters.js");
load("web/js/mt19937.js");
load("web/js/stats.js");
load("web/js/pyramid.js");
load("web/js/analysis.js");

function parseFixture(text) {
  // header line then whitespace-separated floats
  var nl = text.indexOf("\n");
  var hdr = text.slice(0, nl).trim().split(/\s+/).map(Number);
  var nx = hdr[0], ny = hdr[1], nz = hdr[2];
  var body = text.slice(nl + 1).trim().split(/\s+/);
  var N = nx * ny * nz;
  var img = new Float64Array(N);
  for (var i = 0; i < N; i++) img[i] = parseFloat(body[i]);
  return { image: img, nx: nx, ny: ny, nz: nz };
}

var fixture = parseFixture(readFile("test/fixture_gray.txt"));
var ref = JSON.parse(readFile("test/ref_stats.json"));
var meta = ref.meta;

var params = { N_steer: meta.N_steer, N_pyr: meta.N_pyr, N_iteration: 50,
               Na: meta.Na, noise: 0, edge_handling: 0, add_smooth: 0,
               cmask: [1, 1, 1, 1], verbose: 0, interpWeight: -1, statistics: 0 };

var mt = new PS.MT(0);
var res = PS.Analysis.analysis(fixture, params, mt);
var stats = res.stats;

// Compare helpers ------------------------------------------------------------
function flatten(x) {
  // accept Float64Array, Array of numbers, or Array of arrays
  if (x.length === undefined) return [x];
  var out = [];
  for (var i = 0; i < x.length; i++) {
    var e = x[i];
    if (e && e.length !== undefined) for (var j = 0; j < e.length; j++) out.push(e[j]);
    else out.push(e);
  }
  return out;
}
function compareGroup(name, jsVal, refVal) {
  var a = flatten(jsVal), b = flatten(refVal);
  var n = Math.min(a.length, b.length);
  var maxAbs = 0, maxRel = 0, argAbs = -1, scale = 0;
  for (var i = 0; i < n; i++) scale = Math.max(scale, Math.abs(b[i]));
  for (i = 0; i < n; i++) {
    var abs = Math.abs(a[i] - b[i]);
    if (abs > maxAbs) { maxAbs = abs; argAbs = i; }
    // relative to the group scale (robust for correlation matrices near 0)
    var rel = abs / (scale > 1e-12 ? scale : 1);
    if (rel > maxRel) maxRel = rel;
  }
  var lenOk = a.length === b.length;
  // pass if group-relative error is small, or absolute error is tiny
  var pass = lenOk && (maxRel < 2e-3 || maxAbs < 1e-4);
  return { name: name, n: n, lenJs: a.length, lenRef: b.length, lenOk: lenOk,
           maxAbs: maxAbs, maxRel: maxRel, argAbs: argAbs, scale: scale, pass: pass };
}

var groups = [
  ["pixelStats",   stats.pixelStats,   ref.pixelStats],
  ["skewLow",      stats.skewLow,      ref.skewLow],
  ["kurtLow",      stats.kurtLow,      ref.kurtLow],
  ["varHigh",      stats.varHigh,      ref.varHigh],
  ["magMeans",     stats.magMeans,     ref.magMeans],
  ["autoCorLow",   stats.autoCorLow,   ref.autoCorLow],
  ["autoCorMag",   stats.autoCorMag,   ref.autoCorMag],
  ["cousinMagCor", stats.cousinMagCor, ref.cousinMagCor],
  ["parentMagCor", stats.parentMagCor, ref.parentMagCor],
  // JS allocates N_pyr parentRealCor rows but fills N_pyr-1; ref dumps N_pyr-1
  ["parentRealCor", stats.parentRealCor.slice(0, ref.parentRealCor.length), ref.parentRealCor]
];

print("Portilla-Simoncelli statistics validation  (JS analysis vs C++ reference)");
print("image " + meta.nx + "x" + meta.ny + " nz=" + meta.nz +
      "  N_pyr=" + meta.N_pyr + " N_steer=" + meta.N_steer + " Na=" + meta.Na);
print("");
function pad(s, n) { s = "" + s; while (s.length < n) s += " "; return s; }
function padl(s, n) { s = "" + s; while (s.length < n) s = " " + s; return s; }
print(pad("group", 16) + padl("count", 7) + padl("scale", 13) +
      padl("maxAbsErr", 14) + padl("maxRelErr", 13) + "  result");
print(new Array(72).join("-"));

var allPass = true;
for (var g = 0; g < groups.length; g++) {
  var r = compareGroup(groups[g][0], groups[g][1], groups[g][2]);
  allPass = allPass && r.pass;
  var note = r.lenOk ? "" : (" [LEN " + r.lenJs + "!=" + r.lenRef + "]");
  print(pad(r.name, 16) + padl(r.n, 7) + padl(r.scale.toPrecision(5), 13) +
        padl(r.maxAbs.toExponential(3), 14) + padl(r.maxRel.toExponential(3), 13) +
        "  " + (r.pass ? "PASS" : "FAIL") + note);
}
print(new Array(72).join("-"));
print(allPass ? "ALL GROUPS PASS" : "SOME GROUPS FAILED");
if (typeof quit === "function") quit(allPass ? 0 : 1);
