# Bivariate correlation stimuli

Generate bivariate datasets at a **chosen sample Pearson correlation**, render them
as a **scatterplot** or **parallel coordinates** (D3 + canvas), and export
**256×256 PNGs** that can be fed through the Portilla–Simoncelli pipeline in this
repo. This mirrors the stimulus generation in Rensink & Baldridge (2010) and
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
a **scatterplot / parallel-coordinates** toggle, an optional **random seed** (blank
= fresh dataset each time), **Regenerate**, and **Export 256×256 PNG**. The page
reports the achieved sample correlation (equal to the target to floating-point
precision). The exported PNG omits axes — just the data marks on white — so the PS
grayscale analysis sees the data layout as texture.

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
cli/corr_stats <n> <r> <scatter|parallel> [seed] [-- <ps_stats flags>]

# examples
cli/corr_stats 200 0.8 scatter 1               # 1270 PS stats for r=0.8 scatter
cli/corr_stats 200 0.8 parallel 1 -- -H 1      # with the abbreviated header row
for r in 0.0 0.3 0.6 0.9; do
  cli/corr_stats 200 $r scatter 1 | cut -d, -f4   # e.g. track a stat vs r
done
```

(`cli/corr_to_fixture.js` is the rasterizer; it writes the `nx ny nz` + floats
fixture that `ps_stats` reads directly. It is a rasterization of the same marks as
the browser canvas, not a pixel-exact copy.)

## Files

```
index.html              browser UI
js/gen.js               exact-sample-correlation bivariate generator (CorrGen)
js/render.js            canvas renderer for scatter / parallel coords (CorrRender)
js/app.js               UI controller (slider, points, type, seed, PNG export)
lib/d3.v7.min.js        vendored D3 (offline, no CDN)
cli/corr_to_fixture.js  headless rasterizer -> 256x256 grayscale fixture (jsc)
cli/corr_stats          batch: dataset -> stimulus -> PS statistics CSV
```
