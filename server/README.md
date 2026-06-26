# PS service (Node, worker pool)

A lightweight, dependency-free Node.js HTTP service that runs the JavaScript
Portilla–Simoncelli analysis/synthesis on a **pool of worker threads**, so many
requesters can submit images and have them computed in parallel.

## Run

```bash
node server/ps_server.js [--workers N] [--port P]
# default: N = (CPU count − 1), P = 8088
```

Output: `PS server listening on http://localhost:8088 with N worker(s)`.

## Endpoints (CORS-enabled, JSON)

- `GET /health` → `{ ok, workers, busy, queued }`
- `POST /analyze` → `{ ok, stats:{meta,annotated,raw}, dims, analyzeMs }`
- `POST /synthesize` → `{ ok, image:[…0..255], nx, ny, seed, analyzeMs, synthMs }`

Request body — either an encoded image or raw grayscale pixels:

```jsonc
{ "png": "<base64 or data:image/png;base64,...>" }
// or
{ "nx":256, "ny":256, "image":[ /* nx*ny grayscale 0..255 */ ] }
```

Optional fields: `params:{N_steer,N_pyr,Na,iterations}`, `seed` (integer; omit for a
random seed, which is returned), `returnStats:true` (also return input stats from
`/synthesize`).

## Examples

```bash
# health
curl -s localhost:8088/health

# analyze a PNG (stats match the C++ reference / CLI exactly, ~4e-7)
node -e 'const fs=require("fs");fetch("http://localhost:8088/analyze",{method:"POST",
 headers:{"Content-Type":"application/json"},
 body:JSON.stringify({png:fs.readFileSync("reference/data/sample.png").toString("base64")})})
 .then(r=>r.json()).then(j=>console.log(j.dims, j.stats.raw.slice(0,6)))'

# synthesize (returns a 256x256 grayscale texture + the seed used)
node -e 'const fs=require("fs");fetch("http://localhost:8088/synthesize",{method:"POST",
 headers:{"Content-Type":"application/json"},
 body:JSON.stringify({png:fs.readFileSync("reference/data/sample.png").toString("base64"),seed:1234})})
 .then(r=>r.json()).then(j=>console.log("seed",j.seed,"synthMs",j.synthMs,"px",j.image.length))'
```

## Design

- **`ps_server.js`** — HTTP + a fixed pool of `--workers` worker threads, a FIFO
  job queue, and one job per worker at a time (the FFT module keeps a per-worker
  scratch buffer; parallelism comes from multiple workers). Workers that crash are
  respawned. Image buffers are transferred to/from workers (zero-copy).
- **`ps_worker.js`** — loads the PS modules once (warm) and runs analyze/synthesize.
  Clamps scales and centre-crops to a multiple of `2^(P+1)` like the reference.
- **`png.js`** — minimal PNG decoder (built-in `zlib` only) → grayscale.

Because it reuses the exact PS modules, `/analyze` output matches the C++
reference to ~4e-7. With a 4-worker pool, four parallel syntheses run ~3.2× faster
than sequentially.

## Use from the correlation tool

`correlation_percepts/index.html` has a **PS server URL** field and a
**“Synthesize via server →”** button that POSTs the rendered stimulus's grayscale
pixels to `/synthesize` and displays the returned texture. Serve the pages
(`python3 -m http.server` from the repo root) and run this server alongside;
they communicate over HTTP/CORS.
