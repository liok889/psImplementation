#!/usr/bin/env node
// lda_analyze.js — command-line counterpart of the analysis/ browser tool. Feed
// it a training CSV and a test CSV (stimulus sets of visualization pairs
// characterized by their Portilla–Simoncelli statistics); it trains a shrinkage
// LDA to predict which plot of each pair is more strongly correlated, prints
// accuracy stats to stdout, and writes a per-trial (Harrison-format) CSV of the
// model's calls on the TEST pairs (for per-participant JND fitting).
//
// Run:  analysis/cli/lda_analyze --train train.csv --test test.csv --out calls.csv
'use strict';
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..', '..');
const PSData = require(path.join(ROOT, 'analysis', 'psdata.js'));
const PSLDA = require(path.join(ROOT, 'analysis', 'lda.js'));

const HELP = `lda_analyze — correlation-discrimination LDA on PS statistics (command line)

Trains a regularized Linear Discriminant Analysis on pairs of visualizations
(each described by its Portilla–Simoncelli summary statistics) to predict which
plot is more strongly correlated. Trains on one stimulus set, evaluates on
another, prints accuracy to stdout, and writes per-trial model calls for the
TEST pairs (not the training set) in Harrison-et-al. format.

USAGE
  analysis/cli/lda_analyze --train FILE --test FILE [options]

REQUIRED
  --train FILE        training stimulus-set CSV
  --test  FILE        test stimulus-set CSV

OPTIONS (defaults in brackets)
  --mode M            feature construction: concat | difference          [concat]
                        concat     = both plots' full PS-stat vectors (2×)
                        difference = slot0 − slot1 (antisymmetric)
  --covariance C      full | diagonal                                    [full]
                        full     = shrinkage LDA with feature covariance
                        diagonal = per-feature variance only (fast, less accurate)
  --shrinkage L       shrinkage toward scaled identity, 0..1             [0.2]
  --seed N            slot-randomization seed (so L/R can't be learned)  [1]
  --out FILE          per-trial TEST calls, Harrison format              [per_trial_test.csv]
  --train-out FILE    also write per-trial TRAIN calls (in-sample)       [none]
  -h, --help          show this help

OUTPUT
  stdout : accuracy (overall test/train), accuracy per rbase, and — when the test
           set has more than one participant — accuracy per participant.
  --out  : one row per test stimulus:
           rbase,rv,approach,correctChoice,currentChoice,gotItRight,index,jnd,
           participant,vis,rdirection   (jnd left blank for downstream fitting)

NOTES
  Training flattens across participants (every pair is one example). The label is
  which plot is more strongly correlated (|r|); slot assignment is randomized so
  the model can only use the PS statistics, not left/right. Full covariance is the
  most accurate but O(d³) — the concat feature space (~2540 dims) can take a while.

EXAMPLES
  analysis/cli/lda_analyze --train train.csv --test test.csv --out calls.csv
  analysis/cli/lda_analyze --train tr.csv --test te.csv --mode difference --covariance full
  analysis/cli/lda_analyze --train tr.csv --test te.csv --covariance diagonal   # fast
`;

function parseArgs(argv) {
  const a = argv.slice(2);
  const get = (name, def) => { const i = a.indexOf('--' + name); return (i >= 0 && i + 1 < a.length) ? a[i + 1] : def; };
  return {
    help: a.includes('-h') || a.includes('--help'),
    train: get('train', ''),
    test: get('test', ''),
    mode: get('mode', 'concat'),
    covariance: get('covariance', 'full'),
    shrinkage: parseFloat(get('shrinkage', '0.2')),
    seed: parseInt(get('seed', '1'), 10) || 0,
    out: get('out', 'per_trial_test.csv'),
    trainOut: get('train-out', '')
  };
}

// Signed discriminant score for every pair (score > 0 ⇒ slot 0 more correlated).
function scoreRows(model, feat) {
  const scores = new Float64Array(feat.n);
  for (let i = 0; i < feat.n; i++) scores[i] = PSLDA.score(model, feat.X.subarray(i * feat.D, (i + 1) * feat.D));
  return scores;
}
// Accuracy per participant (numeric sort when ids are numbers).
function byParticipant(scores, feat) {
  const m = new Map();
  for (let i = 0; i < feat.n; i++) {
    const p = feat.pairsMeta[i].participant;
    const ok = ((scores[i] > 0 ? 1 : 0) === feat.y[i]) ? 1 : 0;
    let e = m.get(p); if (!e) { e = { n: 0, correct: 0 }; m.set(p, e); }
    e.n++; e.correct += ok;
  }
  return Array.from(m.keys()).sort((x, y) => { const nx = +x, ny = +y; return (isFinite(nx) && isFinite(ny)) ? nx - ny : (x < y ? -1 : x > y ? 1 : 0); })
    .map((k) => { const e = m.get(k); return { participant: k, n: e.n, correct: e.correct, accuracy: e.correct / e.n }; });
}
function pct(x) { return (100 * x).toFixed(1) + '%'; }
function countParticipants(feat) { const s = {}; for (let i = 0; i < feat.n; i++) s[feat.pairsMeta[i].participant] = 1; return Object.keys(s).length; }
function labelFrac1(feat) { let n1 = 0; for (let i = 0; i < feat.n; i++) n1 += feat.y[i]; return n1 / feat.n; }

function main() {
  const cfg = parseArgs(process.argv);
  if (cfg.help) { process.stdout.write(HELP); process.exit(0); }
  if (!cfg.train || !cfg.test) { process.stderr.write('error: --train and --test are required (see --help)\n'); process.exit(2); }
  for (const f of [cfg.train, cfg.test]) if (!fs.existsSync(f)) { process.stderr.write(`error: file not found: ${f}\n`); process.exit(2); }

  const t0 = Date.now();
  process.stderr.write('reading + parsing CSVs…\n');
  const trainParsed = PSData.parseCSV(fs.readFileSync(cfg.train, 'utf8'));
  const testParsed = PSData.parseCSV(fs.readFileSync(cfg.test, 'utf8'));
  const tr = PSData.buildPairs(trainParsed, { mode: cfg.mode, seed: cfg.seed });
  const te = PSData.buildPairs(testParsed, { mode: cfg.mode, seed: (cfg.seed >>> 0) + 1 });

  process.stderr.write(`training LDA (mode=${cfg.mode}, covariance=${cfg.covariance}, shrinkage=${cfg.shrinkage})…\n`);
  const tTrain = Date.now();
  const model = PSLDA.train(tr.X, tr.y, tr.n, tr.D, {
    shrinkage: cfg.shrinkage, covariance: cfg.covariance,
    progress: (f, m) => { if (process.stderr.isTTY) process.stderr.write(`\r  ${(100 * f).toFixed(0)}%  ${m}                    `); }
  });
  if (process.stderr.isTTY) process.stderr.write('\n');
  const trainMs = Date.now() - tTrain;

  const evTr = PSLDA.evaluate(model, tr.X, tr.y, tr.rbase, tr.n, tr.D);
  const evTe = PSLDA.evaluate(model, te.X, te.y, te.rbase, te.n, te.D);
  const scoresTe = scoreRows(model, te), scoresTr = scoreRows(model, tr);
  const bpTe = byParticipant(scoresTe, te);

  // ---- stats report to stdout ----
  const L = [];
  L.push('══ Correlation-discrimination LDA ══');
  L.push(`  train: ${cfg.train}   test: ${cfg.test}`);
  L.push(`  mode=${cfg.mode}  covariance=${cfg.covariance}  shrinkage=${cfg.shrinkage}  seed=${cfg.seed}`);
  L.push(`  PS stats/plot=${trainParsed.P}  features D=${tr.D}  used(d)=${model.d}`);
  L.push(`  train pairs=${tr.n} (${countParticipants(tr)} participant(s), labels ${labelFrac1(tr).toFixed(3)} balanced)`);
  L.push(`  test  pairs=${te.n} (${countParticipants(te)} participant(s), labels ${labelFrac1(te).toFixed(3)} balanced)`);
  L.push('');
  L.push(`  TEST  accuracy: ${pct(evTe.accuracy)}   (${evTe.correct}/${evTe.n})`);
  L.push(`  TRAIN accuracy: ${pct(evTr.accuracy)}   (${evTr.correct}/${evTr.n})`);
  L.push('');
  L.push('  accuracy by rbase:');
  L.push('    rbase   test    n     train');
  const trByR = {}; evTr.byRbase.forEach((x) => { trByR[x.rbase] = x; });
  evTe.byRbase.forEach((x) => {
    const tb = trByR[x.rbase];
    L.push(`    ${x.rbase.toFixed(2).padStart(5)}  ${pct(x.accuracy).padStart(6)}  ${String(x.n).padStart(4)}  ${(tb ? pct(tb.accuracy) : '–').padStart(6)}`);
  });
  if (bpTe.length > 1) {
    L.push('');
    L.push('  accuracy by participant (test):');
    L.push('    participant   test    n');
    bpTe.forEach((x) => { L.push(`    ${String(x.participant).padStart(11)}  ${pct(x.accuracy).padStart(6)}  ${String(x.n).padStart(4)}`); });
  }
  L.push('');
  L.push(`  train time ${(trainMs / 1000).toFixed(1)}s · total ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.stdout.write(L.join('\n') + '\n');

  // ---- per-trial CSVs ----
  fs.writeFileSync(cfg.out, PSData.buildTrialReport(te, scoresTe));
  process.stderr.write(`wrote per-trial TEST calls → ${cfg.out} (${te.n} rows)\n`);
  if (cfg.trainOut) {
    fs.writeFileSync(cfg.trainOut, PSData.buildTrialReport(tr, scoresTr));
    process.stderr.write(`wrote per-trial TRAIN calls → ${cfg.trainOut} (${tr.n} rows)\n`);
  }
}

main();
