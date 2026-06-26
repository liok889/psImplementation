// Benchmark the PS worker pool on an analysis batch.
// Dispatches `--count` analyze jobs (the same image) across a pool of workers,
// for each worker count in `--threads`, with a warm-up phase excluded from
// timing, and reports total time, per-image average, and throughput.
//   node server/bench_worker.js [--count 500] [--threads 1,2,4,6,8,10,12,14] [--reps 2]
'use strict';
const { Worker } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const os = require('os');

const argv = process.argv.slice(2);
function argval(n, d) { const i = argv.indexOf(n); return (i >= 0 && i + 1 < argv.length) ? argv[i + 1] : d; }
const COUNT = parseInt(argval('--count', '500'), 10);
const REPS = parseInt(argval('--reps', '2'), 10);
const THREADS = argval('--threads', '1,2,4,6,8,10,12,14').split(',').map(s => parseInt(s, 10));

// load the sample image (grayscale) from the fixture
function loadFixture() {
  const p = path.join(__dirname, '..', 'test', 'fixture_gray.txt');
  const txt = fs.readFileSync(p, 'utf8');
  const nl = txt.indexOf('\n');
  const h = txt.slice(0, nl).trim().split(/\s+/).map(Number);
  const body = txt.slice(nl + 1).trim().split(/\s+/);
  const N = h[0] * h[1];
  const a = new Float64Array(N);
  for (let i = 0; i < N; i++) a[i] = parseFloat(body[i]);
  return { nx: h[0], ny: h[1], img: a };
}
const base = loadFixture();
const params = { N_steer: 4, N_pyr: 4, Na: 7, N_iteration: 50 };

// run `total` analyze jobs across `nWorkers`, after `warm` warm-up jobs (untimed)
function runBatch(nWorkers, total, warm) {
  return new Promise(function (resolve) {
    const workers = [];
    for (let i = 0; i < nWorkers; i++) workers.push(new Worker(path.join(__dirname, 'ps_worker.js')));
    let phase = 'warm', target = warm, dispatched = 0, completed = 0, jid = 0, t0 = 0;

    function dispatch(w) {
      if (dispatched >= target) return;
      dispatched++;
      const copy = new Float64Array(base.img);           // each job gets its own image data
      w.postMessage({ cmd: 'analyze', jobId: jid++, nx: base.nx, ny: base.ny, image: copy, params: params }, [copy.buffer]);
    }
    function onMsg(w) {
      completed++;
      if (completed >= target) {
        if (phase === 'warm') {
          phase = 'timed'; dispatched = 0; completed = 0; target = total; t0 = process.hrtime.bigint();
          for (const ww of workers) dispatch(ww);
          return;
        }
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        workers.forEach(w2 => w2.terminate());
        resolve(ms);
        return;
      }
      if (dispatched < target) dispatch(w);
    }
    workers.forEach(w => w.on('message', () => onMsg(w)));
    workers.forEach(w => dispatch(w));                    // start warm-up
  });
}

function pad(s, n) { s = '' + s; while (s.length < n) s = ' ' + s; return s; }

(async function () {
  console.log('PS worker benchmark — analysis of ' + COUNT + ' images (256x256 grayscale), ' +
    REPS + ' rep(s), best of reps');
  console.log('machine: ' + os.cpus()[0].model + '  (' + os.cpus().length + ' logical CPUs)');
  console.log('');
  console.log(pad('workers', 8) + pad('total(ms)', 12) + pad('per-image(ms)', 15) +
    pad('throughput(img/s)', 19) + pad('speedup', 9) + pad('efficiency', 12));
  console.log(new Array(76).join('-'));

  const results = [];
  let base1 = null;
  for (const n of THREADS) {
    let best = Infinity;
    for (let r = 0; r < REPS; r++) {
      const ms = await runBatch(n, COUNT, Math.max(n * 4, 16));
      if (ms < best) best = ms;
    }
    const per = best / COUNT, thr = COUNT / (best / 1000);
    if (n === THREADS[0]) base1 = thr;
    results.push({ n, ms: best, per, thr });
    const speedup = base1 ? (thr / base1) : 1;
    console.log(pad(n, 8) + pad(best.toFixed(0), 12) + pad(per.toFixed(2), 15) +
      pad(thr.toFixed(0), 19) + pad(speedup.toFixed(2) + 'x', 9) +
      pad((speedup / n * 100).toFixed(0) + '%', 12));
  }
  console.log(new Array(76).join('-'));
  // pick best: highest throughput; report knee (where adding workers stops helping much)
  let bestCfg = results[0];
  for (const r of results) if (r.thr > bestCfg.thr) bestCfg = r;
  // "recommended": smallest worker count within 5% of peak throughput
  const rec = results.filter(r => r.thr >= bestCfg.thr * 0.95).sort((a, b) => a.n - b.n)[0];
  console.log('peak throughput : ' + bestCfg.thr.toFixed(0) + ' img/s at ' + bestCfg.n + ' workers');
  console.log('recommended     : ' + rec.n + ' workers (' + rec.thr.toFixed(0) +
    ' img/s, ' + rec.per.toFixed(2) + ' ms/image) — smallest pool within 5% of peak');
})();
