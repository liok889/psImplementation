// Lightweight Portilla-Simoncelli analysis/synthesis HTTP service (Node, no deps).
// A configurable pool of worker threads runs the JS PS analysis/synthesis, so
// many requesters can submit images concurrently and have them computed in
// parallel (one job per worker; pool size controls concurrency).
//
//   node server/ps_server.js [--workers N] [--port P]
//
// Endpoints (CORS-enabled, JSON):
//   GET  /health        -> { workers, busy, queued }
//   POST /analyze       -> { ok, stats:{meta,annotated,raw}, dims, analyzeMs }
//   POST /synthesize    -> { ok, image:[...0..255], nx, ny, seed, analyzeMs, synthMs }
// Request body (either form):
//   { "png": "<base64 | data:image/png;base64,...>" , params?, seed?, returnStats? }
//   { "nx":256, "ny":256, "image":[... grayscale 0..255 ...], params?, seed?, returnStats? }
// params: { N_steer, N_pyr, Na, iterations };  seed: integer (omit => random, returned)
'use strict';
const http = require('http');
const os = require('os');
const path = require('path');
const { Worker } = require('worker_threads');
const { decodePNG } = require('./png');

const argv = process.argv.slice(2);
function argval(name, def) { const i = argv.indexOf(name); return (i >= 0 && i + 1 < argv.length) ? argv[i + 1] : def; }
if (argv.includes('--help') || argv.includes('-h')) {
  console.log('usage: node server/ps_server.js [--workers N] [--port P]');
  process.exit(0);
}
const WORKERS = Math.max(1, parseInt(argval('--workers', String(Math.max(1, os.cpus().length - 1))), 10));
const PORT = parseInt(argval('--port', '8088'), 10);
const MAXBODY = 64 * 1024 * 1024;

// ---- worker pool ----
const workers = [];
const idle = [];
const queue = [];
const jobs = new Map();
let nextId = 1;

function spawn() {
  const w = new Worker(path.join(__dirname, 'ps_worker.js'));
  w._job = null;
  w.on('message', function (msg) {
    const job = jobs.get(msg.jobId); jobs.delete(msg.jobId);
    w._job = null; idle.push(w);
    if (job) { msg.ok ? job.resolve(msg) : job.reject(new Error(msg.error || 'worker error')); }
    pump();
  });
  w.on('error', function (err) {
    if (w._job != null) { const job = jobs.get(w._job); jobs.delete(w._job); if (job) job.reject(err); }
    const wi = workers.indexOf(w); if (wi >= 0) workers.splice(wi, 1);
    const ii = idle.indexOf(w); if (ii >= 0) idle.splice(ii, 1);
    spawn(); // respawn to keep the pool size constant
  });
  workers.push(w); idle.push(w);
}
function pump() {
  while (idle.length && queue.length) {
    const w = idle.shift();
    const item = queue.shift();
    w._job = item.payload.jobId;
    const transfer = (item.payload.image && item.payload.image.buffer) ? [item.payload.image.buffer] : [];
    w.postMessage(item.payload, transfer);
  }
}
function run(payload) {
  return new Promise(function (resolve, reject) {
    payload.jobId = nextId++;
    jobs.set(payload.jobId, { resolve, reject });
    queue.push({ payload });
    pump();
  });
}
for (let i = 0; i < WORKERS; i++) spawn();

// ---- http ----
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function sendJSON(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }
function bad(res, code, msg) { sendJSON(res, code, { ok: false, error: msg }); }
function collectBody(req, max) {
  return new Promise(function (resolve, reject) {
    const chunks = []; let size = 0;
    req.on('data', function (c) { size += c.length; if (size > max) { reject(new Error('body too large')); req.destroy(); return; } chunks.push(c); });
    req.on('end', function () { resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

function resolveImage(body) {
  if (body.png) {
    const b64 = String(body.png).replace(/^data:image\/png;base64,/, '');
    const png = decodePNG(Buffer.from(b64, 'base64'));
    return { nx: png.nx, ny: png.ny, image: png.gray };
  }
  if (Array.isArray(body.image) && body.nx && body.ny) {
    return { nx: body.nx | 0, ny: body.ny | 0, image: Float64Array.from(body.image) };
  }
  throw new Error('provide {png} or {nx, ny, image[]}');
}

const server = http.createServer(function (req, res) {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method === 'GET' && req.url === '/health') {
    return sendJSON(res, 200, { ok: true, workers: workers.length, busy: workers.filter(w => w._job != null).length, queued: queue.length });
  }
  if (req.method === 'POST' && (req.url === '/analyze' || req.url === '/synthesize')) {
    collectBody(req, MAXBODY).then(function (buf) {
      let body; try { body = JSON.parse(buf.toString('utf8')); } catch (e) { return bad(res, 400, 'invalid JSON'); }
      let img; try { img = resolveImage(body); } catch (e) { return bad(res, 400, e.message); }
      const cmd = req.url === '/synthesize' ? 'synthesize' : 'analyze';
      const params = body.params || { N_steer: body.N_steer, N_pyr: body.N_pyr, Na: body.Na, N_iteration: body.iterations };
      run({ cmd, nx: img.nx, ny: img.ny, image: img.image, params, seed: body.seed, returnStats: !!body.returnStats })
        .then(function (msg) {
          if (cmd === 'analyze') return sendJSON(res, 200, { ok: true, stats: msg.stats, dims: msg.dims, analyzeMs: msg.analyzeMs });
          const out = { ok: true, nx: msg.nx, ny: msg.ny, seed: msg.seed, analyzeMs: msg.analyzeMs, synthMs: msg.synthMs };
          out.image = Array.prototype.map.call(msg.image, v => Math.round(v));
          if (msg.stats) out.stats = msg.stats;
          sendJSON(res, 200, out);
        })
        .catch(function (e) { bad(res, 500, String(e && e.message || e)); });
    }).catch(function (e) { bad(res, 413, String(e && e.message || e)); });
    return;
  }
  bad(res, 404, 'not found');
});

server.listen(PORT, function () {
  console.log('PS server listening on http://localhost:' + PORT + ' with ' + WORKERS + ' worker(s)');
});
