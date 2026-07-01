// selftest.js — headless validation of the correlation-discrimination LDA using
// JavaScriptCore `jsc`. Loads the real training/test CSVs, builds features, trains
// LDA under a few configurations, and prints overall + per-rbase accuracy with
// timings. Run:
//   jsc analysis/psdata.js analysis/lda.js analysis/selftest.js
// (jsc evaluates files left-to-right in one global scope, so PSData/PSLDA are
//  already defined by the time this file runs).

var TRAIN = 'analysis/training_scatterplot.csv';
var TEST = 'analysis/test_scatterplot.csv';
var MAXPAIRS = 0; // >0 to subsample pairs for a quick smoke test; 0 = use all

function now() { return Date.now(); }

function subsample(feat, maxPairs) {
  if (!maxPairs || maxPairs >= feat.n) return feat;
  var n = maxPairs, D = feat.D;
  var X = new Float64Array(n * D), y = new Int8Array(n), rb = new Float64Array(n);
  for (var i = 0; i < n * D; i++) X[i] = feat.X[i];
  for (var i2 = 0; i2 < n; i2++) { y[i2] = feat.y[i2]; rb[i2] = feat.rbase[i2]; }
  return { X: X, y: y, rbase: rb, n: n, D: D, P: feat.P, mode: feat.mode, featureNames: feat.featureNames };
}

function labelBalance(feat) {
  var n1 = 0; for (var i = 0; i < feat.n; i++) n1 += feat.y[i];
  return { n: feat.n, n1: n1, n0: feat.n - n1, frac1: n1 / feat.n };
}

print('reading CSVs…');
var t0 = now();
var trainText = readFile(TRAIN);
var testText = readFile(TEST);
print('  read in ' + (now() - t0) + ' ms');

var t1 = now();
var trainParsed = PSData.parseCSV(trainText);
var testParsed = PSData.parseCSV(testText);
print('  parsed in ' + (now() - t1) + ' ms; P=' + trainParsed.P +
      ' PS stats/plot; train rows=' + trainParsed.rows.length + ', test rows=' + testParsed.rows.length);

var configs = [
  { mode: 'concat', covariance: 'diagonal', shrinkage: 0.2 },
  { mode: 'difference', covariance: 'diagonal', shrinkage: 0.2 },
  { mode: 'difference', covariance: 'full', shrinkage: 0.2 },
  { mode: 'concat', covariance: 'full', shrinkage: 0.2 }
];

for (var c = 0; c < configs.length; c++) {
  var cfg = configs[c];
  print('\n==================================================================');
  print('CONFIG: mode=' + cfg.mode + ' covariance=' + cfg.covariance + ' shrinkage=' + cfg.shrinkage);

  var tb = now();
  var tr = subsample(PSData.buildPairs(trainParsed, { mode: cfg.mode, seed: 1 }), MAXPAIRS);
  var te = subsample(PSData.buildPairs(testParsed, { mode: cfg.mode, seed: 2 }), MAXPAIRS);
  print('  built features in ' + (now() - tb) + ' ms; D=' + tr.D + ', nTrain=' + tr.n + ', nTest=' + te.n);
  var balTr = labelBalance(tr), balTe = labelBalance(te);
  print('  label balance train: ' + balTr.n1 + '/' + balTr.n + ' (' + balTr.frac1.toFixed(3) +
        '), test: ' + balTe.n1 + '/' + balTe.n + ' (' + balTe.frac1.toFixed(3) + ')');

  var tt = now();
  var model = PSLDA.train(tr.X, tr.y, tr.n, tr.D, {
    shrinkage: cfg.shrinkage, covariance: cfg.covariance,
    progress: function (f, m) { /* quiet */ }
  });
  print('  trained in ' + (now() - tt) + ' ms; d(kept)=' + model.d);

  var evTr = PSLDA.evaluate(model, tr.X, tr.y, tr.rbase, tr.n, tr.D);
  var evTe = PSLDA.evaluate(model, te.X, te.y, te.rbase, te.n, te.D);
  print('  TRAIN accuracy: ' + (100 * evTr.accuracy).toFixed(2) + '%');
  print('  TEST  accuracy: ' + (100 * evTe.accuracy).toFixed(2) + '%');
  print('  TEST accuracy by rbase:');
  for (var r = 0; r < evTe.byRbase.length; r++) {
    var row = evTe.byRbase[r];
    print('    rbase=' + row.rbase.toFixed(2) + '  acc=' + (100 * row.accuracy).toFixed(1) + '%  (n=' + row.n + ')');
  }
}
// ---- per-stimulus (Harrison-format) trial report check ----
print('\n==================================================================');
print('PER-STIMULUS REPORT (concat / diagonal — fast) — Harrison-format output');
var trR = PSData.buildPairs(trainParsed, { mode: 'concat', seed: 1 });
var teR = PSData.buildPairs(testParsed, { mode: 'concat', seed: 2 });
print('  participants: train=' + Object.keys(teR.pairsMeta.reduce(function (a, m) { a[m.participant] = 1; return a; }, {})).length +
      ' (test file), pairs test=' + teR.n);
var modelR = PSLDA.train(trR.X, trR.y, trR.n, trR.D, { shrinkage: 0.2, covariance: 'diagonal' });
var scoresTe = new Float64Array(teR.n);
for (var si = 0; si < teR.n; si++) scoresTe[si] = PSLDA.score(modelR, teR.X.subarray(si * teR.D, (si + 1) * teR.D));
var reportCSV = PSData.buildTrialReport(teR, scoresTe);
var lines = reportCSV.trim().split('\n');
print('  report rows: ' + (lines.length - 1) + ' (expected ' + teR.n + ')');
print('  header: ' + lines[0]);
for (var pl = 1; pl <= 5 && pl < lines.length; pl++) print('    ' + lines[pl]);
// mean(gotItRight) must equal the model's test accuracy (consistency check).
var gcol = lines[0].split(',').indexOf('gotItRight');
var nTrue = 0;
for (var ln = 1; ln < lines.length; ln++) if (lines[ln].split(',')[gcol] === 'true') nTrue++;
var evR = PSLDA.evaluate(modelR, teR.X, teR.y, teR.rbase, teR.n, teR.D);
print('  mean(gotItRight)=' + (100 * nTrue / (lines.length - 1)).toFixed(2) + '%  vs  accuracy=' +
      (100 * evR.accuracy).toFixed(2) + '%  ' +
      (Math.abs(nTrue / (lines.length - 1) - evR.accuracy) < 1e-9 ? '[OK match]' : '[MISMATCH!]'));

print('\ndone.');
