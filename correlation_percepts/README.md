# Bivariate correlation stimuli

Generate bivariate datasets at a **chosen sample Pearson correlation**, render them
as a **scatterplot**, **parallel coordinates**, or an **ordered line** (D3 + canvas),
and export **256×256 PNGs** that can be fed through the Portilla–Simoncelli pipeline
in this repo. This mirrors the stimulus generation in Rensink & Baldridge (2010) and
Harrison et al. (2014), *"Ranking Visualizations of Correlation Using Weber's
Law"* — a natural pairing with PS texture statistics for studying correlation
percepts.

## Browser tool

Serve the repository root and open the page:

```bash
cd ..            # repo root
python3 -m http.server 8000
# open http://localhost:8000/correlation_percepts/index.html
```

Controls: a **correlation slider** (r from −1 to 1), a **number-of-points** field,
a **scatterplot / parallel-coordinates / ordered-line** selector, a **mark-size** slider (circle
radius for scatter / line width for parallel coordinates, in 256px-export units),
an **opacity** slider (default 1 = fully opaque), an optional **random seed** (blank
= fresh dataset each time), **Regenerate**, **Export 256×256 PNG**, and
**Send to PS pipeline →**. Marks are **black**. The page reports the achieved sample correlation (equal to the target to
floating-point precision). Mark size is in export-pixel units and scaled to the
display, so what you see matches the exported PNG. The exported PNG omits axes —
just the data marks on white — so the PS grayscale analysis sees the data layout as
texture.

## Send to PS pipeline (no download/upload)

**Send to PS pipeline →** hands the rendered 256×256 image straight to the
Portilla–Simoncelli web interface (`../web/index.html`) without saving a file:
the PNG data URL is stashed in `localStorage` and the PS window is opened (or, if
already open, reused and focused). The PS page loads the image and runs the
**analysis** automatically (it does *not* start synthesis). A freshly opened PS
window reads the image on load; an already-open one picks it up live via the
`storage` event.

This works because both pages are the **same origin** — so serve them from the
**same** server (the repo-root `python3 -m http.server`) and the handoff is
page-to-page in the browser, no disk round-trip.

## Stimulus collection generation

The **Stimulus collection generation** panel builds a labelled dataset of
visualization *pairs* for perception experiments and runs each plot through the
PS server.

Inputs:
- **Base correlation levels** (`rbase`, comma-separated; default `0.2 … 0.8`)
- **Stimuli (pairs) per base** (default 2000)
- **Participants** (replications of the full design; default 1)
- **Test range** (offset, 0.1–1; default 0.2)
- **Correlation sign** (positive / negative)
- **Max concurrent server requests** (browsers cap ~6 connections per origin)

For each base level it generates `N` pairs. In each pair, one plot is at exactly
`rbase` and the other at `r ~ Uniform[rbase−range, rbase+range]` (cropped to
`[0,1]`); which side (left/right) is the base is randomized. Negative sign negates
both (magnitudes still cropped in `[0,1]` first). Plots use the **current**
visualization type / points / mark size / opacity controls.

**Participants** replicate the whole design: the total number of stimuli is
`pairs-per-base × #bases × #participants`. Each participant is an independent
draw of the same design, and the `stimulus` id restarts at 1 per participant
(a trial number within that participant). Default `1` reproduces the previous
single-set behaviour.

Generation is **non-blocking** (a worker-style concurrency pool of `fetch`
requests to the server) with a **progress bar**, throughput, and ETA. About every
2 s it picks one random recently-processed plot and shows two thumbnails side by
side — the **exact image sent** to the server and its **PS synthesis** — so you can
watch results stream in and confirm the rendering. **Stop** halts early and
downloads what's done.

Output CSV — **one row per visualization** (two rows per pair):

```
stimulus,participant,vis,rbase,r,left_or_right,seed,npoints,<1270 PS statistics columns>
```

`stimulus` = pair id (shared by its two rows, restarts per participant),
`participant` = participant/replication id (integer, right after `stimulus`),
`vis` = visualization type
(`scatter` / `parallel` / `orderedlines`), `r` = that plot's actual correlation,
`left_or_right` = `L`/`R`, `seed` = the per-plot RNG seed, `npoints` = points used,
and the statistics columns use the abbreviated PS field names
(scale/orientation/lag position indicators).

**Reproducing a stimulus:** every plot records its own `seed`, so you can recreate
the exact image from the top controls — set the **visualization type**, enter the
row's **`r`** in the precise number box next to the correlation slider, the
**`seed`** in the seed field, **`npoints`**, and the same mark size/opacity, then
**Regenerate**. (Data depends only on `n`, `r`, and `seed`; `r` is stored to 6
decimals, which reproduces the plot to sub-pixel accuracy.) The CSV is
assembled in memory and downloaded at the end; the default 7×2000 batch is
~28k rows / ~hundreds of MB, so you'll get a size confirmation before it starts.
Requires the PS server (`server/`) running at the **PS server URL**.

## Command-line collection generator (Node.js, parallel)

`cli/gen_stimuli` is the headless counterpart of the **Stimulus collection
generation** panel: it produces the same labelled CSV without a browser or the PS
server, using Node.js `worker_threads` for native parallelism and file I/O. Every
UI parameter is exposed as a flag and the **defaults match the UI**.

```bash
# small labelled set (2 bases × 3 pairs × 2 participants), reproducible
cli/gen_stimuli --bases "0.3,0.6" --per-base 3 --participants 2 --seed 42 --out set.csv

# the UI-default 7-base × 2000-pair set, 8 worker threads
cli/gen_stimuli --per-base 2000 --jobs 8 --out stimuli.csv
```

Flags (defaults in parentheses): `--bases "0.2,…,0.8"`, `--per-base 2000`,
`--participants 1`, `--range 0.2`, `--sign pos|neg`, `--npoints 100`,
`--type scatter|parallel|ordered`, `--marksize 2`, `--opacity 1`, `--size 256`,
`--steer 4` `--scales 4` `--na 7` (PS `N_steer`/`N_pyr`/`Na`), `--seed <uint>`
(default: a random seed, printed to stderr), `--out FILE` (default: stdout),
`--jobs N` (default: CPU count − 1). `-h`/`--help` prints the full usage. The CSV
goes to stdout/`--out`; progress goes to stderr. Smaller `--size` fits fewer
pyramid scales, so the PS analysis clamps `N_pyr` and emits fewer statistic
columns (the default 256 gives the full 1270). Throughput is ~75 plots/s on 13 workers for 100-point scatterplots, so
the default 28k-plot set takes ~6 min.

**Correspondence with the browser.** The task-building and CSV format
(`js/collection.js` → `CorrCollection`) and the exact-correlation data generator
(`js/gen.js` → `CorrGen`) are the **same modules** the browser uses, so task
lists and CSV rows are byte-identical for the same RNG stream, and the PS
analysis is the same reference-validated code (matches `cli/ps_stats` to 0.0).
The **one** difference is rasterization: the browser draws antialiased HTML-canvas
marks, while the CLI (and `cli/corr_to_fixture.js`) use `js/raster.js`
(`CorrRaster`) — hard-edged, deterministic, dependency-free. So PS statistic
*values* differ slightly by rendering; everything else corresponds exactly. Runs
are reproducible (fixed `--seed`) and parallelism never changes the output
(chunking by line index; `--jobs 1` ≡ `--jobs 8`).

## How the data is generated (exact sample correlation)

`js/gen.js`: draw bivariate normal data and impose an **exact in-sample** Pearson
correlation `r`:

1. draw `x, y ~ N(0,1)` (seedable via D3's `randomLcg`);
2. standardize `x` to mean 0, unit variance;
3. residualize `y` on `x` and standardize ⇒ `y` is exactly uncorrelated with `x`;
4. set `y' = r·x + sqrt(1−r²)·y` ⇒ `corr(x, y') == r` exactly.

Verified to machine precision for all `r` (incl. ±1) and `n`.

## Headless / batch pipeline (correlation → PS statistics)

To process many stimuli without the browser, `cli/corr_stats` generates a dataset,
rasterizes it to a 256×256 grayscale stimulus, and runs it through the PS
statistics tool (`../cli/ps_stats`), printing the CSV to stdout:

```bash
cli/corr_stats <n> <r> <scatter|parallel|ordered> [seed] [-- <ps_stats flags>]

# examples
cli/corr_stats 200 0.8 scatter 1               # 1270 PS stats for r=0.8 scatter
cli/corr_stats 200 0.8 parallel 1 -- -H 1      # with the abbreviated header row
for r in 0.0 0.3 0.6 0.9; do
  cli/corr_stats 200 $r scatter 1 | cut -d, -f4   # e.g. track a stat vs r
done
```

(`cli/corr_to_fixture.js` is the rasterizer; it writes the `nx ny nz` + floats
fixture that `ps_stats` reads directly. It draws black marks and accepts optional
`size markSize opacity` arguments after the seed, e.g.
`jsc cli/corr_to_fixture.js -- <root> 200 0.8 scatter 1 256 4 0.5`. It is a
rasterization of the same marks as the browser canvas, not a pixel-exact copy.)

## Files

```
index.html              browser UI
js/gen.js               exact-sample-correlation bivariate generator (CorrGen)
js/render.js            canvas renderer for scatter / parallel coords (CorrRender)
js/raster.js            headless hard-edged rasterizer (CorrRaster) — shared by CLI tools
js/collection.js        shared task-building + CSV format (CorrCollection) — browser & CLI
js/app.js               UI controller (slider, points, type, seed, PNG export)
lib/d3.v7.min.js        vendored D3 (offline, no CDN)
cli/gen_stimuli(.js)    Node.js parallel collection generator (all UI params as flags)
cli/corr_to_fixture.js  headless rasterizer -> size×size grayscale fixture (jsc, uses CorrRaster)
cli/corr_stats          batch: single dataset -> stimulus -> PS statistics CSV (jsc)
```
