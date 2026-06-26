# Portilla–Simoncelli Texture Model — JavaScript implementation

A browser implementation of the Portilla & Simoncelli parametric texture
analysis/synthesis algorithm (a steerable-pyramid joint-statistics model), ported
faithfully from the C++ reference in [`reference/`](reference/) and **validated
against it**: the statistics extracted by the JavaScript code match those computed
by the original C++ statistics code to ~4×10⁻⁷ relative error.

> Reference: J. Portilla and E. Simoncelli, *A parametric texture model based on
> joint statistics of complex wavelet coefficients*, IJCV 40 (2000). The C++
> reference is the IPOL publication by Briand & Vacher (2021).

The browser app lets you:

1. **upload an image** (or load the bundled sample),
2. see the **pyramid decomposition** — the pyramid filters and the filter outputs
   (oriented sub-bands + low/high residuals) at every scale,
3. see the **extracted joint statistics**, and
4. **synthesize a new texture** with the same statistics, iteratively, with a live
   preview and PNG download.

This port targets the **grayscale** path (matching the reference's `-b 1` mode),
which is the fully validated one. Color (PCA + complex cross-correlations) is
scaffolded in the code but not the primary target — see *Scope* below.

---

## Quick start — run the app

The app is plain ES5-style JavaScript with **no build step and no dependencies**.
Serve the repository root over HTTP (needed so the page can fetch the sample image)
and open the app:

```bash
cd /Users/redak/VisProjects/psImplement
python3 -m http.server 8000
# then open  http://localhost:8000/web/index.html
```

Click **Load reference sample** (or **Upload image…**), then **Analyze**, then
**Synthesize texture**.

App features:
- **Show all statistics** / **Download statistics (JSON)** — view or export the full
  ~1270 scalar constraints (structured JSON with a legend for each field).
- **Random seed** box in the synthesis panel — leave blank for a fresh pseudo-random
  texture each run, or enter an integer to reproduce a specific result. The seed
  actually used is reported under the preview (same seed ⇒ identical output).
- **Download synthesized stats (JSON)** — re-analyzes the synthesized texture and
  exports *its* statistics, so you can diff synthesized-vs-target constraints.

## Quick start — run the validation

```bash
bash test/run.sh
```

This (1) decodes `reference/data/sample.png` into a shared numeric fixture, (2)
builds and runs the C++ reference statistics harness, (3) runs the JS analysis and
compares every statistic group against the C++ output, and (4) runs the JS
synthesis self-consistency check. Expected tail:

```
group             count        scale     maxAbsErr    maxRelErr  result
-----------------------------------------------------------------------
pixelStats            6       3511.5      3.262e-5     9.289e-9  PASS
skewLow               5       1.8144      2.329e-7     1.284e-7  PASS
...
parentRealCor        96       7.1473      3.034e-6     4.244e-7  PASS
-----------------------------------------------------------------------
ALL GROUPS PASS
```

## Command-line JS statistics tool

A headless analog of the reference's `-S`/`-H` mode, using the JavaScript
implementation (via JavaScriptCore `jsc`). It prints the synthesis-relevant
statistics as CSV to stdout, in the same order — and with `-H 1`, the same
abbreviated header names — as the C++ tool:

```bash
cli/ps_stats reference/data/sample.png            # one CSV line of values
cli/ps_stats reference/data/sample.png -H 1       # header row + values
cli/ps_stats reference/data/sample.png -s 3 -k 5 -N 5 -H 1
cli/ps_stats test/fixture_gray.txt -H 1           # a .txt fixture also works
```

A PNG/JPG/TIFF input is decoded to a grayscale fixture via
`tools/png_to_fixture.py`; a `.txt` fixture (`nx ny nz` then floats) is used
directly. Its output's header row is byte-identical to `portilla_simoncelli
… -S 1 -H 1`, and the values match to ~4e-7 (float-vs-double).

---

## How validation works (and why it's set up this way)

The dev environment has **no Node.js, no Homebrew, and no `libfftw3`/`libpng`**, so
the reference can't be built via its makefile and the JS can't be tested with Node.
The pipeline works around that without compromising rigor:

| concern | solution |
|---|---|
| run JS headlessly | **JavaScriptCore `jsc`** (ships with macOS). Modules are written UMD-style (attach to a global `PS`) so the *same files* run in `jsc` and the browser. |
| decode the PNG | **`tools/png_to_fixture.py`** — pure stdlib (`zlib`) PNG decoder → a numeric fixture shared by C++ and JS, so both analyze byte-identical pixels. |
| run the real C++ stats code without fftw/libpng | **`reference_harness/`** recompiles the *genuine* reference `.cpp` files (filters / pyramid / analysis / constraints / pca) against a tiny **FFTW-API shim** (`fftw3.h` + `fftw_shim.cpp`, radix-2 + Bluestein FFT) and a text fixture reader. Eigen is the bundled header-only copy. |

So the "C++ statistics" the JS is checked against are produced by the reference's
own statistical formulas — only the FFT backend and image IO are swapped. Any
algorithmic discrepancy in the JS port surfaces as a mismatch; the only residual
difference is float-vs-double rounding (~1e-7 relative).

**Synthesis** is additionally checked for *self-consistency*
(`test/run_synthesis_check.js`): synthesize from the target statistics, re-analyze
the result, and confirm the achieved statistics converge to the targets (pixel
statistics to <0.1%, auto-correlations <1%, magnitude correlations ~3%). It is not
a bit-match to the reference output image — the noise seed and FFT precision
differ by design.

---

## Native reference build & benchmark

The original C++ program builds on macOS (Apple clang + MacPorts) once the libs
are installed (`fftw3f`, `libpng/jpeg/tiff`, `libomp`). The stock makefile flags
need three adjustments — `-fopenmp` → `-Xpreprocessor -fopenmp` with
`-I/opt/local/include/libomp`, `-lfftw3f_omp` → `-lfftw3f_threads`, and the
MacPorts `-I/-L /opt/local` paths:

```bash
cd reference && make portilla_simoncelli \
  CC=clang CXX=clang++ \
  CFLAGS="-Wall -O3 -march=native -I/opt/local/include -I/opt/local/include/libomp -Xpreprocessor -fopenmp" \
  LDFLAGS="-L/opt/local/lib -L/opt/local/lib/libomp -lm -lpng -ljpeg -ltiff -lstdc++ -lfftw3f -lfftw3f_threads -lomp"
./portilla_simoncelli data/sample.png out.png -b 1     # grayscale
```

(One portability fix to the vendored `iio.c` was required: on arm64 macOS
`long double == double`, which made two `switch` `case` labels collide — the
`long double` case is now guarded by `__LDBL_MANT_DIG__`.)

**Statistics-only mode (`-S`).** The reference has an added flag that runs the
analysis and prints the synthesis-relevant summary statistics as a single CSV
line to stdout (no header), then skips synthesis:

```bash
./portilla_simoncelli data/sample.png -S 1 > stats.csv
```

In `-S` mode the **output path is optional** and **grayscale is forced** (a color
input is converted, with a note to stderr), so the single command above is enough.

Add `-H 1` to also emit a **header row** of abbreviated column names that encode
each statistic's origin — scale `s`, orientation `o`, lag `dx`/`dy`, parent
real/imag band — e.g. `autoCorrLow_s0_dx-3_dy-3`, `magMean_s1_o2`,
`parentRealCorr_s2_3_o3_im3`:

```bash
./portilla_simoncelli data/sample.png -S 1 -H 1 > stats.csv
```

The values and their order match the JavaScript implementation's raw export
exactly (including `magMeans`, which the `-o` text dump omits). Verify with
`bash test/verify_cpp_csv.sh` — the C++ and JS outputs agree value-by-value to
~4e-7 (float-vs-double rounding).

**Benchmark — JS vs native C++**, analysis and synthesis timed separately, same
256×256 grayscale fixture, same parameters (P=4, K=4, Na=7, 50 iterations), both
single-threaded (native = real FFTW, JS = JavaScriptCore):

```bash
bash bench/run.sh
```

A formatted standalone report of these results is in
[`bench/report.html`](bench/report.html).

| stage | native C++ (FFTW) | JavaScript (jsc) | JS / C++ |
|---|--:|--:|--:|
| **analysis** (once) | ~26 ms | ~72 ms | **~2.8×** |
| **synthesis** (50 iters) | ~2.1 s | ~6.2 s | **~3.0×** |
| synthesis per iteration | ~42 ms | ~125 ms | ~3.0× |

So the pure-JavaScript port runs about **3× slower** than optimized native C++ —
a strong result given the native build uses FFTW (hand-tuned SIMD) while the JS
uses a custom double-precision FFT with no SIMD. (Numbers are from JavaScriptCore;
a browser's V8 may differ. Multi-threading the native build via OpenMP/FFTW
threads does *not* help at 256×256 — thread overhead dominates and the stock
multi-threaded binary is actually slower than single-threaded here.)

## Project layout

```
web/                       browser app (no build step)
  index.html               UI
  js/
    fft.js                 FFT (radix-2 + Bluestein), FFTW conventions     [toolbox.cpp]
    filters.js             steerable-pyramid frequency filters             [filters.cpp]
    mt19937.js             Mersenne Twister (bit-identical to reference)    [mt19937ar.cpp]
    stats.js               moments, auto-/cross-correlation (compute_*)    [constraints.cpp]
    linalg.js              eigensolver, linear solve, inverse, poly roots  [Eigen]
    pyramid.js             multi-scale pyramid decomposition               [pyramid.cpp]
    analysis.js            pixel + summary statistics extraction           [analysis.cpp]
    adjust.js              adjust_* (marginal / autocorr / crosscorr)      [constraints.cpp]
    adjust_cross_scale.js  complex cross-scale correlation adjustment      [constraints.cpp]
    synthesis.js           iterative synthesis + adjust_constraints        [synthesis.cpp]
    main.js                UI controller (upload, render, synthesize)
reference_harness/         C++ statistics harness (genuine reference code + FFTW shim)
cli/ps_stats[.js]          headless JS stats tool (CSV to stdout; C++ -S/-H analog)
tools/png_to_fixture.py    stdlib PNG decoder -> shared fixture
test/
  run.sh                   full pipeline
  run_validation.js        JS analysis vs C++ reference (jsc)
  run_synthesis_check.js   JS synthesis convergence (jsc)
reference/                 the original C++ implementation (unmodified)
correlation_percepts/      bivariate correlation-stimulus generator (scatter /
                           parallel coords, D3) + 256x256 PNG export for the PS
                           pipeline; see its own README
server/                    Node worker-pool HTTP service: POST an image, get
                           analysis stats and/or a synthesized texture; see its
                           own README
```

The JS keeps the reference's data conventions verbatim: planar channels with
linear index `i + j*nx + k*nx*ny`, and FFTW transform conventions (forward
`e^{-2πi}`, inverse unnormalized then divided by `N`). Statistic array layouts
mirror `write_statistics()` in `constraints.cpp`.

## The statistics: what they are and how they're computed

The model summarizes a texture by a fixed set of **scalar constraints** measured on
its steerable-pyramid decomposition. For the default parameters (`P=4` scales,
`K=4` orientations, `Na=7` neighborhood, grayscale) there are exactly **1270**
of them:

| # | group | what it represents | formula | count |
|---|---|---|---|--:|
| 1 | `pixelStats` | marginal stats of the image: **min, max, mean, variance, skewness, kurtosis** | 6 | **6** |
| 2 | `skewLow` | **skewness** of the low-pass image at each scale (finest→coarsest) | 1+P | **5** |
| 3 | `kurtLow` | **kurtosis** of the low-pass image at each scale | 1+P | **5** |
| 4 | `varHigh` | **variance** of the high-pass residual | nz | **1** |
| 5 | `magMeans` | **mean magnitude** of each oriented sub-band | P·K | **16** |
| 6 | `autoCorLow` | central **Na×Na auto-correlation** of each low-pass image | (1+P)·Na² | **245** |
| 7 | `autoCorMag` | central **Na×Na auto-correlation** of each sub-band **magnitude** | P·K·Na² | **784** |
| 8 | `cousinMagCor` | **magnitude cross-correlation across orientations** (same scale) | P·K² | **64** |
| 9 | `parentMagCor` | **magnitude cross-correlation with the coarser scale** | (P−1)·K² | **48** |
| 10 | `parentRealCor` | **real-part / phase cross-correlation with the coarser scale** | (P−1)·2K² | **96** |
| | | | **total** | **1270** |

Verification: the JS serializer (and the app's JSON export) emits exactly **1270**
finite scalars; the reference's `write_statistics()` text dump writes **1254** —
the difference is the 16 `magMeans`, which the reference computes and *imposes*
during synthesis but does not write to its statistics file
(`1270 − 16 = 1254`, both confirmed empirically). Counting *independent* degrees of
freedom instead of stored numbers (auto-correlations are point-symmetric, so only
`(Na²+1)/2 = 25` of each 49-block is independent; correlation matrices are
symmetric) gives ≈710, matching the figure cited in the Portilla–Simoncelli paper.

### How each group is computed

All quantities are computed on the pyramid built by `create_pyramid` (high-pass
residual, `P` low-pass residuals, and `P·K` complex oriented sub-bands). Bands are
made zero-mean before correlations.

- **`pixelStats`** — min, max, and the first four moments taken directly over all
  image pixels (variance = 2nd central moment, skewness = 3rd⁄σ³, kurtosis = 4th⁄σ⁴).
  Computed before the tiny stabilizing noise is added.
- **`skewLow` / `kurtLow`** — at each scale the low-pass image is taken (a second
  low-pass is applied first, as in the reference), and its skewness/kurtosis are
  computed about zero mean (variance read from the auto-correlation center). These
  capture how the brightness distribution's *shape* changes from fine to coarse.
- **`varHigh`** — variance (2nd moment about 0) of the high-pass residual: the
  energy in the finest, non-oriented high frequencies.
- **`magMeans`** — for each oriented sub-band, the complex **magnitude**
  `√(re²+im²)` is formed and its mean over the band stored. The mean is then
  subtracted so the magnitude correlations below describe *fluctuations*.
- **`autoCorLow` / `autoCorMag`** — the **central `Na×Na` block** of the
  auto-correlation, computed efficiently as `iFFT(|FFT(x)|²)` (Wiener–Khinchin) and
  normalized; the central value (lag 0) equals the variance. `autoCorLow` runs on
  each low-pass image (periodicity / global layout); `autoCorMag` runs on each
  sub-band's mean-removed magnitude (spatial extent, spacing and regularity of
  oriented features). See *the neighborhood `Na`* below.
- **`cousinMagCor`** — the `K×K` Gram matrix `M·Mᵀ⁄N` of the `K` mean-removed
  magnitude bands at one scale (`M` stacks the bands as rows). It captures how
  feature *energy* co-occurs across orientations (corners, junctions, isotropy vs.
  anisotropy).
- **`parentMagCor`** — cross-correlation (`K×K`, `M_fine·M_parentᵀ⁄N`) between a
  scale's `K` magnitude bands and the next-**coarser** scale's bands. The coarser
  bands ("parents") are Fourier-**upsampled** to align with the finer resolution,
  magnitude taken, mean removed. Captures coarse-to-fine energy consistency.
- **`parentRealCor`** — cross-correlation between a scale's `K` **real** (signed)
  sub-bands and the coarser scale's **phase-doubled** parents — the real and
  imaginary parts of the upsampled coarse band with its phase doubled
  (`2·atan2(im,re)`), giving `2K` bands. This encodes the **phase** relationships
  across scale that keep edges, gradients and shadows aligned rather than smeared.

### The neighborhood `Na`

`Na` is the **side length, in pixels, of the square window over which the
auto-correlation statistics are measured** (default `7`, must be odd; the `-N`
flag / the **Na** field in the app). The full auto-correlation of a band is
computed via `iFFT(|FFT|²)`, and only the **central `Na × Na` block** is kept — the
correlation coefficients for integer pixel lags `(dx,dy) ∈ {−hNa … +hNa}²`, where
`hNa = (Na−1)/2`. So `Na=7 → hNa=3 →` lags from −3 to +3 in each direction = a 7×7
grid of 49 values; the center (lag 0,0) is the variance.

It is a **per-scale** window: a 1-pixel lag at scale *s* equals `2^s` pixels in the
original image, so the same small `Na` reaches farther at coarser scales. `Na` must
be odd and smaller than every scale's dimensions, so the number of scales is clamped
to `P_max = floor(log₂(min(nx,ny)) − log₂(Na+1) − 1)` (the app does this on upload).
On the synthesis side, imposing an `Na×Na` auto-correlation needs support
`2·Na−1 = 13`, and the linear system solved has size `(Na²+1)/2 = 25` (the
independent half, by the symmetry `Ac(i,j)=Ac(−i,−j)`).

### Why only the central `Na × Na` block?

A 7×7 window sounds tiny next to a 256×256 image, but it is the right amount of
information for three reasons:

1. **The pyramid already covers long range.** A lag is measured at each scale's
   resolution, so a 7×7 window reaches ±3·2ˢ original pixels at scale *s*: ±3, ±6,
   ±12, ±24, ±48 px across the four scales (and the coarsest 16×16 low residual
   spans the whole image's low-frequency structure). Long-range correlations in the
   original become **short-range correlations at a coarse scale**. Between the
   pyramid and `Na` the model constrains structure from ~1 px to ~100 px — not tiny.

2. **The full auto-correlation is just the power spectrum, and that's not enough.**
   Capturing *all* lags of the auto-correlation is mathematically equivalent to
   fixing the entire power spectrum. Matching only the spectrum (plus pixel
   marginals) produces phase-randomized "spectral noise", which looks nothing like
   structured texture. The PS insight is that what carries texture appearance is a
   **compact** set of correlations of **nonlinear features** (sub-band
   *magnitudes*) **across orientation and scale** — groups 5–10 above — not the
   full second-order spectrum. The short auto-correlations supply local geometry;
   the cross-correlations supply the feature interactions.

3. **A compact summary models the texture *class*, not the exemplar.** The goal is
   to synthesize *new* samples that look like the same material, not to reproduce
   the input. Constraining the full N×N auto-correlation would over-fit one image
   (and large-lag estimates are noisy anyway, computed from few independent
   samples). A small, reliable neighborhood generalizes.

So the central block is deliberate: short-range geometry per scale, with everything
longer-range handled by the multi-scale + cross-scale structure of the model.

## Scope & limitations

- **Grayscale** is the validated path. The color path (Appendix B: PCA color
  decorrelation, cousin/parent real correlations, complex covariance adjustment)
  is partially scaffolded and guarded with `nz === 3` branches but is not the
  deliverable here.
- **Edge handling** (periodic+smooth decomposition) and **texture interpolation**
  (two inputs) from the reference are not ported; defaults match the reference
  with these off.
- Synthesis runs ~130 ms/iteration at 256×256 in `jsc`/browser (≈6–7 s for the
  default 50 iterations). Arbitrary upload sizes are cropped to a multiple of
  `2^(P+1)` (centered), exactly as the reference, and `P` is reduced if the image
  is too small.
