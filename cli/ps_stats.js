// Headless JS statistics tool (runs under JavaScriptCore `jsc`), the analog of
// the reference C++ "-S" / "-H" mode. It runs the JS analysis on a grayscale
// fixture and prints the synthesis-relevant summary statistics as a CSV line to
// stdout, in the same order as the C++ tool. With a header flag it also prints a
// first line of abbreviated column names identical to the C++ "-H" output.
//
// Invoked (via the cli/ps_stats wrapper) as:
//   jsc cli/ps_stats.js -- <root> <fixture.txt> [-H 1] [-s P] [-k K] [-N Na]
'use strict';

var argv = (typeof arguments !== 'undefined') ? Array.prototype.slice.call(arguments) : [];
if (argv.length < 2) { print("usage: jsc ps_stats.js -- <root> <fixture> [-H 1] [-s P] [-k K] [-N Na]"); if (typeof quit === 'function') quit(2); }
var ROOT = argv[0], fixturePath = argv[1];

["fft","filters","mt19937","stats","linalg","pyramid","analysis","adjust","adjust_cross_scale","synthesis","statsjson"]
  .forEach(function (m) { load(ROOT + "/web/js/" + m + ".js"); });

// ---- parse flags ----
var header = 0, P = 4, K = 4, Na = 7;
for (var i = 2; i < argv.length; i++) {
  var a = argv[i];
  if (a === '-H' || a === '--header') { var n = argv[i + 1]; if (n === '0' || n === '1') { header = parseInt(n, 10); i++; } else header = 1; }
  else if (a === '-s') P = parseInt(argv[++i], 10);
  else if (a === '-k') K = parseInt(argv[++i], 10);
  else if (a === '-N') Na = parseInt(argv[++i], 10);
}

// ---- read the fixture: "nx ny nz" then nx*ny*nz floats ----
var text = readFile(fixturePath);
var nl = text.indexOf("\n");
var h = text.slice(0, nl).trim().split(/\s+/).map(Number);
var nx = h[0], ny = h[1], nz = h[2];
var body = text.slice(nl + 1).trim().split(/\s+/);
var img = new Float64Array(nx * ny * nz);
for (i = 0; i < img.length; i++) img[i] = parseFloat(body[i]);

// ---- clamp P and centre-crop to a multiple of 2^(P+1) (mirrors reference/app) ----
function cropClamp(image, nx, ny, P, Na) {
  var minSize = Math.min(nx, ny);
  var Pmax = Math.floor((Math.log(minSize) - Math.log(Na + 1)) / Math.log(2) - 1);
  if (Pmax < 1) Pmax = 1; if (P > Pmax) P = Pmax;
  var pow = 1 << (P + 1);
  var remx = nx % pow, remy = ny % pow, rx = remx >> 1, ry = remy >> 1;
  var cnx = nx - remx, cny = ny - remy;
  var out = new Float64Array(cnx * cny);
  for (var j = 0; j < cny; j++) for (var ii = 0; ii < cnx; ii++) out[ii + j * cnx] = image[(ii + rx) + (j + ry) * nx];
  return { image: out, nx: cnx, ny: cny, nz: 1, P: P };
}
var c = cropClamp(img, nx, ny, P, Na); P = c.P;

var params = { N_steer: K, N_pyr: P, N_iteration: 50, Na: Na, noise: 0, edge_handling: 0,
               add_smooth: 0, cmask: [1, 1, 1, 1], verbose: 0, interpWeight: -1, statistics: 0 };

// analysis with MT seeded 0 (matches the reference default seed for the noise step)
var stats = PS.Analysis.analysis({ image: c.image, nx: c.nx, ny: c.ny, nz: 1 }, params, new PS.MT(0)).stats;
var obj = PS.StatsJSON.statsToObject(stats, params, { nx: c.nx, ny: c.ny }, "ps_stats");

// %.9g-style formatting to match the C++ tool's CSV style
function fmt(v) {
  if (v === 0) return "0";
  var s = v.toPrecision(9);
  if (s.indexOf('e') < 0 && s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}
// abbreviated column name, identical scheme to the C++ "-H" header
var MEAS = { min: "min", max: "max", mean: "mean", variance: "var", skewness: "skew", kurtosis: "kurt" };
function cppName(e) {
  switch (e.group) {
    case "pixelMarginal":    return "pix_" + MEAS[e.measure];
    case "lowbandMarginal":  return (e.measure === "skewness" ? "skewLow_s" : "kurtLow_s") + e.scale;
    case "highpassVariance": return "varHigh";
    case "magnitudeMean":    return "magMean_s" + e.scale + "_o" + e.orientation;
    case "autoCorrelation":
      return e.on === "low-band"
        ? "autoCorrLow_s" + e.scale + "_dx" + e.lagX + "_dy" + e.lagY
        : "autoCorrMag_s" + e.scale + "_o" + e.orientation + "_dx" + e.lagX + "_dy" + e.lagY;
    case "crossCorrelation":
      if (e.kind === "magnitude cousins") return "cousinMagCorr_s" + e.scale + "_o" + e.orientation1 + "_o" + e.orientation2;
      if (e.kind === "magnitude parents") return "parentMagCorr_s" + e.scale + "_" + e.coarserScale + "_o" + e.orientation + "_o" + e.parentOrientation;
      return "parentRealCorr_s" + e.scale + "_" + e.coarserScale + "_o" + e.orientation + "_" + (e.parentPart === "real" ? "re" : "im") + e.parentOrientation;
  }
  return e.key;
}

if (header) print(obj.annotated.map(cppName).join(','));
print(obj.raw.map(fmt).join(','));
