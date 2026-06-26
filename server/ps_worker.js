// Worker thread for the PS server. Loads the (runtime-agnostic) PS modules once,
// then handles analyze/synthesize jobs sent from the pool. One job at a time per
// worker (the FFT module keeps a per-instance scratch buffer); parallelism comes
// from running several workers.
'use strict';
const { parentPort } = require('worker_threads');
const path = require('path');

const dir = path.join(__dirname, '..', 'web', 'js');
['fft', 'filters', 'mt19937', 'stats', 'linalg', 'pyramid', 'analysis',
 'adjust', 'adjust_cross_scale', 'synthesis', 'statsjson']
  .forEach(function (m) { require(path.join(dir, m + '.js')); });
const PS = globalThis.PS;

// clamp the number of scales and centre-crop to a multiple of 2^(P+1)
// (mirrors the reference / app behavior)
function cropClamp(image, nx, ny, P, Na) {
  const minSize = Math.min(nx, ny);
  let Pmax = Math.floor((Math.log(minSize) - Math.log(Na + 1)) / Math.log(2) - 1);
  if (Pmax < 1) Pmax = 1;
  if (P > Pmax) P = Pmax;
  const pow = 1 << (P + 1);
  const remx = nx % pow, remy = ny % pow, rx = remx >> 1, ry = remy >> 1;
  const cnx = nx - remx, cny = ny - remy;
  const out = new Float64Array(cnx * cny);
  for (let j = 0; j < cny; j++) for (let i = 0; i < cnx; i++)
    out[i + j * cnx] = image[(i + rx) + (j + ry) * nx];
  return { image: out, nx: cnx, ny: cny, P: P };
}

parentPort.on('message', function (job) {
  try {
    let image = job.image;
    if (!(image instanceof Float64Array)) image = Float64Array.from(image);
    const p0 = job.params || {};
    const Na = p0.Na || 7, K = p0.N_steer || 4, Preq = p0.N_pyr || 4;
    const iters = p0.N_iteration || 50;

    const c = cropClamp(image, job.nx, job.ny, Preq, Na);
    const params = { N_steer: K, N_pyr: c.P, N_iteration: iters, Na: Na, noise: 0,
                     edge_handling: 0, add_smooth: 0, cmask: [1, 1, 1, 1],
                     verbose: 0, interpWeight: -1, statistics: 0 };

    const t0 = Date.now();
    const stats = PS.Analysis.analysis({ image: c.image, nx: c.nx, ny: c.ny, nz: 1 }, params, new PS.MT(0)).stats;
    const analyzeMs = Date.now() - t0;
    const statsObj = PS.StatsJSON.statsToObject(stats, params, { nx: c.nx, ny: c.ny }, 'server(' + job.cmd + ')');

    if (job.cmd === 'analyze') {
      parentPort.postMessage({ jobId: job.jobId, ok: true, stats: statsObj,
        dims: { nx: c.nx, ny: c.ny, N_pyr: c.P, N_steer: K, Na: Na }, analyzeMs });
      return;
    }

    // synthesize
    const usedSeed = (job.seed === null || job.seed === undefined || job.seed === '')
      ? (Math.floor(Math.random() * 4294967296) >>> 0) : (job.seed >>> 0);
    const tex = { image: new Float64Array(c.nx * c.ny), nx: c.nx, ny: c.ny, nz: 1 };
    const t1 = Date.now();
    PS.Synthesis.synthesis(tex, stats, params, new PS.MT(usedSeed));
    const synthMs = Date.now() - t1;
    const outImg = new Float64Array(tex.image.length);
    for (let i = 0; i < outImg.length; i++) { const v = tex.image[i]; outImg[i] = v < 0 ? 0 : v > 255 ? 255 : v; }
    parentPort.postMessage({
      jobId: job.jobId, ok: true, image: outImg, nx: c.nx, ny: c.ny, seed: usedSeed,
      analyzeMs, synthMs, stats: job.returnStats ? statsObj : undefined
    }, [outImg.buffer]);
  } catch (e) {
    parentPort.postMessage({ jobId: job && job.jobId, ok: false, error: String((e && e.stack) || e) });
  }
});
