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
function pct(x) { return (100 * x).toFixed(1) + '%'; }
// numeric sort of a Map's keys when they parse as numbers, else lexicographic.
function sortKeys(keys) {
  return keys.sort((x, y) => { const nx = +x, ny = +y; return (isFinite(nx) && isFinite(ny)) ? nx - ny : (x < y ? -1 : x > y ? 1 : 0); });
}
function tallyToArray(map, nameKey) {
  return sortKeys(Array.from(map.keys())).map((k) => { const e = map.get(k); const o = { n: e.n, correct: e.correct, accuracy: e.correct / e.n }; o[nameKey] = k; return o; });
}

// Read a file line-by-line (bounded memory), calling onLine for each. The first
// line (header) and empty lines are handled by the caller via onLine.
function streamLines(file, onLine) {
  const readline = require('readline');
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
    rl.on('line', (line) => { try { onLine(line); } catch (e) { rl.close(); reject(e); } });
    rl.on('close', resolve);
    rl.on('error', reject);
  });
}

// throttled stderr status (in-place on a TTY, periodic line when piped)
const isTTY = !!process.stderr.isTTY;
let _lastStatus = 0;
function status(msg, force) {
  const now = Date.now();
  if (!force && now - _lastStatus < (isTTY ? 100 : 3000)) return;
  _lastStatus = now;
  process.stderr.write(isTTY ? '\r  ' + msg + '                    ' : '  ' + msg + '\n');
}

// Stream a training CSV into an in-memory feature matrix (training inherently
// needs all pairs). Returns a feature set compatible with PSLDA.train/evaluate.
async function loadTrainStreaming(file, mode, seed) {
  let hdr = null, ps = null;
  const feats = [], labels = [], rbases = [], metas = [];
  const parts = new Set();
  await streamLines(file, (line) => {
    if (line === '') return;
    if (!hdr) { hdr = PSData.parseHeaderLine(line); ps = PSData.createPairStream(hdr, { mode, seed }); return; }
    const pr = ps.push(PSData.parseDataLine(line, hdr));
    if (pr) {
      feats.push(pr.feature); labels.push(pr.label); rbases.push(pr.rbase); metas.push(pr.meta);
      parts.add(pr.meta.participant);
      if ((feats.length & 1023) === 0) status(`loading training pairs: ${feats.length}`);
    }
  });
  const n = feats.length, D = ps.D;
  const X = new Float64Array(n * D);
  for (let i = 0; i < n; i++) X.set(feats[i], i * D);
  const y = new Int8Array(n), rbase = new Float64Array(n);
  for (let i = 0; i < n; i++) { y[i] = labels[i]; rbase[i] = rbases[i]; }
  feats.length = 0; // free the per-pair arrays
  return { X, y, rbase, n, D, P: hdr.P, pairsMeta: metas, featureNames: ps.featureNames, nParticipants: parts.size };
}

// Stream a test CSV through the trained model one pair at a time: score each,
// write its per-trial (Harrison-format) row to `outFd`, and accumulate accuracy
// tallies. Never holds the whole test set — memory is O(1). Returns eval stats.
async function streamTestEval(file, mode, seed, model, outFd) {
  let hdr = null, ps = null;
  let correct = 0, ntot = 0, n1 = 0;
  const byR = new Map(), byP = new Map(), idxByP = new Map();
  let buf = [PSData.TRIAL_COLUMNS.join(',') + '\n'], bufBytes = buf[0].length;
  const flush = () => { if (buf.length) { fs.writeSync(outFd, buf.join('')); buf = []; bufBytes = 0; } };
  await streamLines(file, (line) => {
    if (line === '') return;
    if (!hdr) {
      hdr = PSData.parseHeaderLine(line);
      ps = PSData.createPairStream(hdr, { mode, seed });
      if (ps.D !== model.D) throw new Error(`test feature dim ${ps.D} != model ${model.D} (train/test must share --mode, points, size)`);
      return;
    }
    const pr = ps.push(PSData.parseDataLine(line, hdr));
    if (!pr) return;
    const score = PSLDA.score(model, pr.feature);
    const ok = ((score > 0 ? 1 : 0) === pr.label) ? 1 : 0;
    correct += ok; ntot++; n1 += pr.label;
    let er = byR.get(pr.rbase); if (!er) { er = { n: 0, correct: 0 }; byR.set(pr.rbase, er); } er.n++; er.correct += ok;
    const part = pr.meta.participant;
    let ep = byP.get(part); if (!ep) { ep = { n: 0, correct: 0 }; byP.set(part, ep); } ep.n++; ep.correct += ok;
    const idx = idxByP.get(part) || 0; idxByP.set(part, idx + 1);
    const s = PSData.trialRowStr(pr.meta, score, idx) + '\n';
    buf.push(s); bufBytes += s.length; if (bufBytes >= (1 << 20)) flush();
    if ((ntot & 2047) === 0) status(`scoring test pairs: ${ntot}`);
  });
  flush();
  return {
    accuracy: ntot ? correct / ntot : 0, n: ntot, correct, frac1: ntot ? n1 / ntot : 0,
    nParticipants: byP.size,
    byRbase: tallyToArray(byR, 'rbase'),
    byParticipant: tallyToArray(byP, 'participant')
  };
}

async function main() {
  const cfg = parseArgs(process.argv);
  if (cfg.help) { process.stdout.write(HELP); process.exit(0); }
  if (!cfg.train || !cfg.test) { process.stderr.write('error: --train and --test are required (see --help)\n'); process.exit(2); }
  for (const f of [cfg.train, cfg.test]) if (!fs.existsSync(f)) { process.stderr.write(`error: file not found: ${f}\n`); process.exit(2); }

  const t0 = Date.now();

  // ---- train (streamed load; training needs all pairs in memory) ----
  process.stderr.write(`loading training set (streaming): ${cfg.train}\n`);
  const tr = await loadTrainStreaming(cfg.train, cfg.mode, cfg.seed);
  if (isTTY) process.stderr.write('\n');
  process.stderr.write(`training LDA on ${tr.n} pairs (mode=${cfg.mode}, covariance=${cfg.covariance}, shrinkage=${cfg.shrinkage})…\n`);
  const tTrain = Date.now();
  const model = PSLDA.train(tr.X, tr.y, tr.n, tr.D, {
    shrinkage: cfg.shrinkage, covariance: cfg.covariance,
    progress: (f, m) => status(`${(100 * f).toFixed(0)}%  ${m}`)
  });
  if (isTTY) process.stderr.write('\n');
  const trainMs = Date.now() - tTrain;
  const evTr = PSLDA.evaluate(model, tr.X, tr.y, tr.rbase, tr.n, tr.D);

  // ---- test (streamed: score + write per-trial calls + tally, O(1) memory) ----
  process.stderr.write(`evaluating test set (streaming) → per-trial calls: ${cfg.out}\n`);
  const outFd = fs.openSync(cfg.out, 'w');
  const evTe = await streamTestEval(cfg.test, cfg.mode, (cfg.seed >>> 0) + 1, model, outFd);
  fs.closeSync(outFd);
  if (isTTY) process.stderr.write('\n');

  // ---- stats report to stdout ----
  const trFrac1 = (() => { let s = 0; for (let i = 0; i < tr.n; i++) s += tr.y[i]; return s / tr.n; })();
  const L = [];
  L.push('══ Correlation-discrimination LDA ══');
  L.push(`  train: ${cfg.train}   test: ${cfg.test}`);
  L.push(`  mode=${cfg.mode}  covariance=${cfg.covariance}  shrinkage=${cfg.shrinkage}  seed=${cfg.seed}`);
  L.push(`  PS stats/plot=${tr.P}  features D=${tr.D}  used(d)=${model.d}`);
  L.push(`  train pairs=${tr.n} (${tr.nParticipants} participant(s), labels ${trFrac1.toFixed(3)} balanced)`);
  L.push(`  test  pairs=${evTe.n} (${evTe.nParticipants} participant(s), labels ${evTe.frac1.toFixed(3)} balanced)`);
  L.push('');
  L.push(`  TEST  accuracy: ${pct(evTe.accuracy)}   (${evTe.correct}/${evTe.n})`);
  L.push(`  TRAIN accuracy: ${pct(evTr.accuracy)}   (${evTr.correct}/${evTr.n})`);
  L.push('');
  L.push('  accuracy by rbase:');
  L.push('    rbase   test    n     train');
  const trByR = {}; evTr.byRbase.forEach((x) => { trByR[x.rbase] = x; });
  evTe.byRbase.forEach((x) => {
    const tb = trByR[x.rbase];
    L.push(`    ${x.rbase.toFixed(2).padStart(5)}  ${pct(x.accuracy).padStart(6)}  ${String(x.n).padStart(5)}  ${(tb ? pct(tb.accuracy) : '–').padStart(6)}`);
  });
  if (evTe.byParticipant.length > 1) {
    L.push('');
    L.push('  accuracy by participant (test):');
    L.push('    participant   test    n');
    evTe.byParticipant.forEach((x) => { L.push(`    ${String(x.participant).padStart(11)}  ${pct(x.accuracy).padStart(6)}  ${String(x.n).padStart(5)}`); });
  }
  L.push('');
  L.push(`  train time ${(trainMs / 1000).toFixed(1)}s · total ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.stdout.write(L.join('\n') + '\n');

  process.stderr.write(`wrote per-trial TEST calls → ${cfg.out} (${evTe.n} rows)\n`);
  if (cfg.trainOut) {
    fs.writeFileSync(cfg.trainOut, PSData.buildTrialReport(tr, scoreRows(model, tr)));
    process.stderr.write(`wrote per-trial TRAIN calls → ${cfg.trainOut} (${tr.n} rows)\n`);
  }
}

main().catch((e) => { process.stderr.write('\nerror: ' + (e && e.stack || e) + '\n'); process.exit(1); });
