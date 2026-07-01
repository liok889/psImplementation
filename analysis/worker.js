// worker.js — off-main-thread parsing, training and evaluation for the
// correlation-discrimination classifier. Kept off the UI thread because full
// covariance LDA on the concatenated feature space can take ~1–2 minutes.
//
// Reads the CSV File objects with FileReaderSync (available inside workers), so
// the large files never touch the main thread.
'use strict';
importScripts('psdata.js', 'lda.js');

function post(type, extra) {
  var msg = { type: type };
  if (extra) for (var k in extra) msg[k] = extra[k];
  postMessage(msg);
}

function readFileText(file) {
  var reader = new FileReaderSync();
  return reader.readAsText(file);
}

function labelBalance(feat) {
  var n1 = 0; for (var i = 0; i < feat.n; i++) n1 += feat.y[i];
  return { n: feat.n, n1: n1, n0: feat.n - n1, frac1: n1 / feat.n };
}

function countParticipants(feat) {
  var s = {}; for (var i = 0; i < feat.n; i++) s[feat.pairsMeta[i].participant] = 1;
  return Object.keys(s).length;
}

// Signed discriminant score for every pair (score > 0 ⇒ slot 0 more correlated).
function scoreRows(model, feat) {
  var scores = new Float64Array(feat.n);
  for (var i = 0; i < feat.n; i++) {
    scores[i] = PSLDA.score(model, feat.X.subarray(i * feat.D, (i + 1) * feat.D));
  }
  return scores;
}

// Accuracy per participant, sorted (numerically when ids are numbers).
function byParticipant(scores, feat) {
  var m = new Map();
  for (var i = 0; i < feat.n; i++) {
    var p = feat.pairsMeta[i].participant;
    var ok = ((scores[i] > 0 ? 1 : 0) === feat.y[i]) ? 1 : 0;
    var e = m.get(p); if (!e) { e = { n: 0, correct: 0 }; m.set(p, e); }
    e.n++; e.correct += ok;
  }
  var keys = Array.from(m.keys()).sort(function (a, b) {
    var na = +a, nb = +b;
    if (isFinite(na) && isFinite(nb)) return na - nb;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return keys.map(function (k) { var e = m.get(k); return { participant: k, n: e.n, correct: e.correct, accuracy: e.correct / e.n }; });
}

onmessage = function (e) {
  var d = e.data;
  try {
    var opts = { mode: d.mode, seed: d.seed };
    var t0 = Date.now();

    post('progress', { phase: 'read', frac: 0.02, msg: 'reading training file…' });
    var trainText = readFileText(d.trainFile);
    post('progress', { phase: 'read', frac: 0.08, msg: 'reading test file…' });
    var testText = readFileText(d.testFile);

    post('progress', { phase: 'parse', frac: 0.12, msg: 'parsing training data…' });
    var trainParsed = PSData.parseCSV(trainText);
    post('progress', { phase: 'parse', frac: 0.18, msg: 'parsing test data…' });
    var testParsed = PSData.parseCSV(testText);

    post('progress', { phase: 'features', frac: 0.22, msg: 'building features…' });
    var tr = PSData.buildPairs(trainParsed, { mode: d.mode, seed: d.seed });
    var te = PSData.buildPairs(testParsed, { mode: d.mode, seed: (d.seed >>> 0) + 1 });

    // Training flattens all participants: every pair (across every participant)
    // is one independent training example. The participant field is used only to
    // pair the two plots correctly and to pass through to the test results.
    post('progress', { phase: 'train', frac: 0.25, msg: 'training LDA…' });
    var tTrain = Date.now();
    var model = PSLDA.train(tr.X, tr.y, tr.n, tr.D, {
      shrinkage: d.shrinkage,
      covariance: d.covariance,
      progress: function (f, m) {
        // Map the 0..1 training fraction into the 0.25..0.9 band of the whole job.
        post('progress', { phase: 'train', frac: 0.25 + 0.65 * f, msg: m });
      }
    });
    var trainMs = Date.now() - tTrain;

    post('progress', { phase: 'eval', frac: 0.92, msg: 'evaluating…' });
    var evTr = PSLDA.evaluate(model, tr.X, tr.y, tr.rbase, tr.n, tr.D);
    var evTe = PSLDA.evaluate(model, te.X, te.y, te.rbase, te.n, te.D);

    // Per-stimulus correct/incorrect calls in Harrison-et-al. format, for later
    // per-participant JND fitting. Test = the model's out-of-sample behaviour.
    post('progress', { phase: 'report', frac: 0.96, msg: 'building per-stimulus calls…' });
    var scoresTe = scoreRows(model, te), scoresTr = scoreRows(model, tr);
    var perStimulusTestCSV = PSData.buildTrialReport(te, scoresTe);
    var perStimulusTrainCSV = PSData.buildTrialReport(tr, scoresTr);
    // Per-participant accuracy breakdown (participant passed through to results).
    evTe.byParticipant = byParticipant(scoresTe, te);
    evTr.byParticipant = byParticipant(scoresTr, tr);

    post('result', {
      result: {
        mode: d.mode, covariance: d.covariance, shrinkage: d.shrinkage, seed: d.seed,
        P: trainParsed.P, D: tr.D, dKept: model.d,
        nTrain: tr.n, nTest: te.n,
        nParticipantsTrain: countParticipants(tr), nParticipantsTest: countParticipants(te),
        balanceTrain: labelBalance(tr), balanceTest: labelBalance(te),
        train: evTr, test: evTe,
        perStimulusTestCSV: perStimulusTestCSV, perStimulusTrainCSV: perStimulusTrainCSV,
        trainMs: trainMs, totalMs: Date.now() - t0
      }
    });
  } catch (err) {
    post('error', { message: (err && err.message) ? err.message : String(err) });
  }
};
