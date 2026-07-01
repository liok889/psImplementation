#!/usr/bin/env node
// gen_stimuli.js — command-line counterpart of the browser "Stimulus collection
// generation" panel, in Node.js with native parallelism (worker_threads) and
// file I/O. Generates a labelled dataset of visualization *pairs*, rasterizes
// each plot (CorrRaster — hard-edged, deterministic; the headless counterpart of
// the browser canvas), runs it through the Portilla–Simoncelli analysis, and
// writes the CSV in the exact same format as the browser. Progress → stderr.
//
// All browser UI parameters are exposed as flags; defaults match the UI.
//   --bases "0.2,0.3,0.4,0.5,0.6,0.7,0.8"   base correlation levels
//   --per-base 2000        pairs per base level
//   --participants 1       replications of the full design
//   --range 0.2            comparison offset (Uniform[rbase-range, rbase+range])
//   --sign pos|neg         correlation sign
//   --npoints 100          points per plot
//   --type scatter|parallel|ordered
//   --marksize 2           circle radius / line width (px @ size)
//   --opacity 1
//   --size 256             raster size (px, square)
//   --steer 4 --scales 4 --na 7   PS analysis params (N_steer, N_pyr, Na)
//   --seed <uint>          reproducible collection (default: a random seed, printed)
//   --out FILE             write CSV here (default: stdout)
//   --jobs N               parallel worker threads (default: CPU count − 1)
//
// Examples:
//   node cli/gen_stimuli.js --bases "0.3,0.6" --per-base 5 --participants 2 --out set.csv
//   node cli/gen_stimuli.js --per-base 2000 --jobs 8 --out big.csv
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const ROOT = path.join(__dirname, '..', '..');

// ---- load the shared generation modules + PS analysis (runtime-agnostic) ----
function loadModules() {
  global.d3 = require(path.join(ROOT, 'correlation_percepts', 'lib', 'd3.v7.min.js'));
  require(path.join(ROOT, 'correlation_percepts', 'js', 'gen.js'));
  require(path.join(ROOT, 'correlation_percepts', 'js', 'raster.js'));
  require(path.join(ROOT, 'correlation_percepts', 'js', 'collection.js'));
  const dir = path.join(ROOT, 'web', 'js');
  ['fft', 'filters', 'mt19937', 'stats', 'linalg', 'pyramid', 'analysis',
   'adjust', 'adjust_cross_scale', 'synthesis', 'statsjson']
    .forEach((m) => require(path.join(dir, m + '.js')));
  return { CorrGen: global.CorrGen, CorrRaster: global.CorrRaster,
           CorrCollection: global.CorrCollection, PS: global.PS };
}

// centre-crop to a multiple of 2^(P+1) and clamp P (mirrors the reference/server).
function cropClamp(image, nx, ny, P, Na) {
  const minSize = Math.min(nx, ny);
  let Pmax = Math.floor((Math.log(minSize) - Math.log(Na + 1)) / Math.log(2) - 1);
  if (Pmax < 1) Pmax = 1;
  if (P > Pmax) P = Pmax;
  const pow = 1 << (P + 1);
  const remx = nx % pow, remy = ny % pow, rx = remx >> 1, ry = remy >> 1;
  const cnx = nx - remx, cny = ny - remy;
  const out = new Float64Array(cnx * cny);
  for (let j = 0; j < cny; j++) for (let i = 0; i < cnx; i++) out[i + j * cnx] = image[(i + rx) + (j + ry) * nx];
  return { image: out, nx: cnx, ny: cny, P: P };
}

// --- minimal 8-bit grayscale PNG writer (Node built-in zlib only) ---
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); }
  return (~c) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function writeGrayPNG(file, pixels, w, h) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 0; // 8-bit, grayscale (color type 0)
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0; // filter: none
    for (let x = 0; x < w; x++) { let v = Math.round(pixels[y * w + x]); v = v < 0 ? 0 : v > 255 ? 255 : v; raw[y * (w + 1) + 1 + x] = v; }
  }
  const idat = zlib.deflateSync(raw);
  fs.writeFileSync(file, Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]));
}
// pick `k` distinct indices from [0,n) uniformly at random (partial Fisher-Yates)
function pickDistinct(n, k, rand) {
  const a = new Array(n); for (let i = 0; i < n; i++) a[i] = i;
  k = Math.min(k, n);
  for (let i = 0; i < k; i++) { const j = i + Math.floor(rand() * (n - i)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a.slice(0, k);
}

// ============================ WORKER ============================
// Rebuilds the full (deterministic, seeded) task list and processes only its
// assigned [start, end) slice, writing finished CSV rows to its part file.
if (!isMainThread) {
  const { CorrGen, CorrRaster, CorrCollection, PS } = loadModules();
  const cfg = workerData.cfg;
  const rng = CorrCollection.mulberry32(cfg.seed >>> 0);
  const tasks = CorrCollection.buildTasks(
    { bases: cfg.bases, n: cfg.perBase, range: cfg.range, sign: cfg.sign, participants: cfg.participants }, rng);
  const vis = CorrCollection.visLabel(cfg.type);

  function analyzeRaw(r, seed) {
    const pts = CorrGen.generate(cfg.npoints, r, seed);
    const img = CorrRaster.rasterize(pts, { size: cfg.size, type: cfg.type, markSize: cfg.markSize, opacity: cfg.opacity, pad: 10 });
    const c = cropClamp(img, cfg.size, cfg.size, cfg.N_pyr, cfg.Na);
    const params = { N_steer: cfg.N_steer, N_pyr: c.P, N_iteration: 50, Na: cfg.Na, noise: 0,
                     edge_handling: 0, add_smooth: 0, cmask: [1, 1, 1, 1], verbose: 0, interpWeight: -1, statistics: 0 };
    const stats = PS.Analysis.analysis({ image: c.image, nx: c.nx, ny: c.ny, nz: 1 }, params, new PS.MT(0)).stats;
    return PS.StatsJSON.statsToObject(stats, params, { nx: c.nx, ny: c.ny }, 'corr');
  }

  const fd = fs.openSync(workerData.partPath, 'w');
  let buf = [], done = 0, headerWritten = false;
  const flush = () => { if (buf.length) { fs.writeSync(fd, buf.join('')); buf = []; } };
  for (let i = workerData.start; i < workerData.end; i++) {
    const t = tasks[i];
    const obj = analyzeRaw(t.r, t.seed);
    if (workerData.emitHeader && !headerWritten) {
      buf.push(CorrCollection.header(obj.annotated.map((a) => a.key)).join(',') + '\n');
      headerWritten = true;
    }
    buf.push(CorrCollection.rowStr(t, obj.raw, vis, cfg.npoints) + '\n');
    done++;
    if (buf.length >= 256) flush();
    if ((done & 15) === 0) parentPort.postMessage({ type: 'progress', done });
  }
  flush();
  fs.closeSync(fd);
  parentPort.postMessage({ type: 'done', done });
  return;
}

// ============================ MAIN ============================
function parseArgs(argv) {
  const a = argv.slice(2);
  const get = (name, def) => { const i = a.indexOf('--' + name); return (i >= 0 && i + 1 < a.length) ? a[i + 1] : def; };
  const bases = get('bases', '0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8')
    .split(',').map((s) => parseFloat(s)).filter((x) => isFinite(x));
  return {
    bases,
    perBase: parseInt(get('per-base', '2000'), 10),
    participants: parseInt(get('participants', '1'), 10),
    range: parseFloat(get('range', '0.2')),
    sign: (get('sign', 'pos') === 'neg') ? -1 : 1,
    npoints: parseInt(get('npoints', '100'), 10),
    type: get('type', 'scatter'),
    markSize: parseFloat(get('marksize', '2')),
    opacity: parseFloat(get('opacity', '1')),
    size: parseInt(get('size', '256'), 10),
    N_steer: parseInt(get('steer', '4'), 10),
    N_pyr: parseInt(get('scales', '4'), 10),
    Na: parseInt(get('na', '7'), 10),
    testVis: parseInt(get('test-vis', '0'), 10),
    seed: get('seed', '') === '' ? (Math.floor(Math.random() * 4294967296) >>> 0) : (parseInt(get('seed', ''), 10) >>> 0),
    _seedGiven: a.indexOf('--seed') >= 0,
    out: get('out', ''),
    jobs: parseInt(get('jobs', String(Math.max(1, os.cpus().length - 1))), 10)
  };
}

const HELP = `gen_stimuli — command-line stimulus-collection generator (Node.js, parallel)

Generates a labelled dataset of visualization *pairs* at chosen base correlations,
rasterizes each plot, runs it through the Portilla-Simoncelli analysis, and writes
the CSV (same format as the browser generator). One row per visualization, two
rows per stimulus pair; a 'participant' column follows 'stimulus'.

USAGE
  cli/gen_stimuli [options]                 # or: node cli/gen_stimuli.js [options]

OPTIONS (defaults in brackets — identical to the browser UI)
  Collection design
    --bases LIST        base correlation levels, comma-separated  [0.2,0.3,0.4,0.5,0.6,0.7,0.8]
    --per-base N        stimulus pairs per base level             [2000]
    --participants N    replications of the full design           [1]
    --range R           comparison offset; the non-base plot is
                        r ~ Uniform[rbase-R, rbase+R] (cropped)    [0.2]
    --sign pos|neg      correlation sign                          [pos]

  Plot appearance (mirrors the browser controls)
    --type T            scatter | parallel | ordered              [scatter]
    --npoints N         data points per plot                      [100]
    --marksize M        mark size: circle radius (scatter) or
                        line width (parallel/ordered), px @ size   [2]
    --opacity O         mark opacity, 0..1                        [1]
    --size PX           raster size (square, px)                  [256]

  PS analysis
    --steer N           orientations (N_steer)                    [4]
    --scales N          pyramid scales (N_pyr)                    [4]
    --na N              autocorrelation neighbourhood (Na)        [7]

  Run control
    --seed UINT         reproducible collection (default: random, printed)
    --jobs N            parallel worker threads                   [CPU count - 1]
    --out FILE          write CSV here (in --test-vis mode: output DIR) [stdout]
    -h, --help          show this help

  Sanity check
    --test-vis X        don't generate the CSV; instead render X randomly-chosen
                        stimuli as PNGs (each plot's input visualization + its PS
                        synthesis) into the --out directory [gen_testvis] and exit.
                        Only the sampled plots are computed.

NOTES
  CSV goes to --out (or stdout); progress goes to stderr. Runs are reproducible
  with a fixed --seed, and --jobs never changes the output. Rendering uses a
  hard-edged rasterizer (not the browser's antialiased canvas), so PS statistic
  values differ slightly from the browser; everything else corresponds exactly.

EXAMPLES
  cli/gen_stimuli --bases "0.3,0.6" --per-base 5 --participants 2 --out set.csv
  cli/gen_stimuli --per-base 2000 --seed 42 --jobs 8 --out big.csv
  cli/gen_stimuli --type parallel --npoints 200 --marksize 1 --opacity 0.5 --out pc.csv
`;

// --test-vis mode: render X randomly-chosen stimuli as PNGs — the input
// visualization and its PS synthesis — for a quick sanity check. No CSV is
// produced, and only the sampled plots are computed, so it returns promptly.
function testVisMode(cfg) {
  const { CorrGen, CorrRaster, CorrCollection, PS } = loadModules();
  const tasks = CorrCollection.buildTasks(
    { bases: cfg.bases, n: cfg.perBase, range: cfg.range, sign: cfg.sign, participants: cfg.participants },
    CorrCollection.mulberry32(cfg.seed >>> 0));
  const total = tasks.length;
  const X = Math.min(cfg.testVis, total);
  const idxs = pickDistinct(total, X, Math.random);         // fresh random sample each run
  const dir = cfg.out || 'gen_testvis';
  fs.mkdirSync(dir, { recursive: true });
  process.stderr.write(`test-vis: rendering ${X} of ${total} random stimuli (input + PS synthesis) to ${dir}/ — no CSV\n`);

  const t0 = Date.now();
  for (let n = 0; n < X; n++) {
    const t = tasks[idxs[n]];
    const pts = CorrGen.generate(cfg.npoints, t.r, t.seed);
    const raster = CorrRaster.rasterize(pts, { size: cfg.size, type: cfg.type, markSize: cfg.markSize, opacity: cfg.opacity, pad: 10 });
    const c = cropClamp(raster, cfg.size, cfg.size, cfg.N_pyr, cfg.Na);
    const params = { N_steer: cfg.N_steer, N_pyr: c.P, N_iteration: 50, Na: cfg.Na, noise: 0,
                     edge_handling: 0, add_smooth: 0, cmask: [1, 1, 1, 1], verbose: 0, interpWeight: -1, statistics: 0 };
    const stats = PS.Analysis.analysis({ image: c.image, nx: c.nx, ny: c.ny, nz: 1 }, params, new PS.MT(0)).stats;
    const tex = { image: new Float64Array(c.nx * c.ny), nx: c.nx, ny: c.ny, nz: 1 };
    PS.Synthesis.synthesis(tex, stats, params, new PS.MT((Math.random() * 4294967296) >>> 0));

    const tag = `testvis_${String(n + 1).padStart(2, '0')}_p${t.participant}_s${t.stim}${t.lr}_r${+t.r.toFixed(3)}`;
    writeGrayPNG(path.join(dir, tag + '_input.png'), raster, cfg.size, cfg.size);
    writeGrayPNG(path.join(dir, tag + '_synth.png'), tex.image, c.nx, c.ny);
    process.stderr.write(`  [${n + 1}/${X}] ${tag}  (input ${cfg.size}×${cfg.size}, synth ${c.nx}×${c.ny})\n`);
  }
  process.stderr.write(`done: wrote ${X * 2} PNGs to ${dir}/ in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
}

function main() {
  const a = process.argv.slice(2);
  if (a.includes('-h') || a.includes('--help')) { process.stdout.write(HELP); process.exit(0); }
  const cfg = parseArgs(process.argv);
  if (!cfg.bases.length) { process.stderr.write('no valid base correlation levels\n'); process.exit(2); }
  if (cfg.testVis > 0) { testVisMode(cfg); return; }
  const total = 2 * cfg.perBase * cfg.bases.length * cfg.participants;
  let jobs = Math.max(1, Math.min(cfg.jobs, Math.ceil(total / 1)));
  const chunk = Math.ceil(total / jobs);

  process.stderr.write(
    `gen_stimuli: ${cfg.bases.length} bases × ${cfg.perBase} pairs × ${cfg.participants} participants = ${total} plots` +
    ` · type=${cfg.type} npoints=${cfg.npoints} size=${cfg.size} · seed ${cfg.seed}` +
    `${cfg._seedGiven ? '' : ' (random)'} · ${jobs} worker(s)\n`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'genstim-'));
  const t0 = Date.now();
  const perWorkerDone = new Array(jobs).fill(0);
  const parts = [];
  let finished = 0;
  const isTTY = !!process.stderr.isTTY;
  let lastRender = 0;

  function fmtDur(s) {
    if (!isFinite(s) || s < 0) s = 0;
    return s >= 60 ? Math.floor(s / 60) + 'm' + String(Math.round(s % 60)).padStart(2, '0') + 's' : s.toFixed(0) + 's';
  }
  // Progress bar → stderr. In-place (\r) on a TTY; a fresh line every ~2s when
  // stderr is redirected/piped so logs stay readable. `force` bypasses throttle.
  function progress(force) {
    const now = Date.now();
    if (!force && now - lastRender < (isTTY ? 100 : 2000)) return;
    lastRender = now;
    const d = perWorkerDone.reduce((s, x) => s + x, 0);
    const frac = total ? Math.min(1, d / total) : 1;
    const el = (now - t0) / 1000, rate = d / Math.max(el, 1e-6);
    const width = 28, filled = Math.round(frac * width);
    const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
    const eta = d > 0 ? fmtDur((total - d) / Math.max(rate, 1e-6)) : '—';
    const line = `  [${bar}] ${String(Math.round(100 * frac)).padStart(3)}%  ${d}/${total}  ${rate.toFixed(0)} plots/s  ETA ${eta}`;
    process.stderr.write(isTTY ? '\r' + line + '   ' : line + '\n');
  }

  let launched = 0;
  for (let j = 0; j < jobs; j++) {
    const start = j * chunk, end = Math.min((j + 1) * chunk, total);
    if (start >= total) break;
    launched++;
    const partPath = path.join(tmp, `part_${j}.csv`);
    parts[j] = partPath;
    const w = new Worker(__filename, {
      workerData: { cfg, start, end, emitHeader: j === 0, partPath }
    });
    w.on('message', (m) => {
      if (m.type === 'progress') { perWorkerDone[j] = m.done; progress(); }
      else if (m.type === 'done') {
        perWorkerDone[j] = m.done; finished++; progress(true);
        if (finished === launched) assemble();
      }
    });
    w.on('error', (e) => { process.stderr.write('\nworker error: ' + e.stack + '\n'); process.exit(1); });
  }
  progress(true);   // show 0% immediately

  function assemble() {
    progress(true);
    if (isTTY) process.stderr.write('\n');
    // concatenate part files in order (part 0 carries the header)
    const outFd = cfg.out ? fs.openSync(cfg.out, 'w') : 1; // 1 = stdout
    for (let j = 0; j < parts.length; j++) {
      if (!parts[j] || !fs.existsSync(parts[j])) continue;
      const rd = fs.openSync(parts[j], 'r');
      const bufSz = 1 << 20, b = Buffer.allocUnsafe(bufSz); let n;
      while ((n = fs.readSync(rd, b, 0, bufSz, null)) > 0) fs.writeSync(outFd, b, 0, n);
      fs.closeSync(rd);
    }
    if (cfg.out) { fs.closeSync(outFd); process.stderr.write(`wrote ${cfg.out} (${total} rows) in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`); }
    try { for (const p of parts) if (p && fs.existsSync(p)) fs.unlinkSync(p); fs.rmdirSync(tmp); } catch (e) {}
  }
}

main();
