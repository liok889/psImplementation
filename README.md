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
tools/png_to_fixture.py    stdlib PNG decoder -> shared fixture
test/
  run.sh                   full pipeline
  run_validation.js        JS analysis vs C++ reference (jsc)
  run_synthesis_check.js   JS synthesis convergence (jsc)
reference/                 the original C++ implementation (unmodified)
```

The JS keeps the reference's data conventions verbatim: planar channels with
linear index `i + j*nx + k*nx*ny`, and FFTW transform conventions (forward
`e^{-2πi}`, inverse unnormalized then divided by `N`). Statistic array layouts
mirror `write_statistics()` in `constraints.cpp`.

## The statistics (what gets validated)

Per the model, for `P` scales, `K` orientations, neighborhood `Na`:

- **marginal** pixel stats (min/max/mean/var/skew/kurtosis), per-scale low-band
  skew/kurtosis, high-pass variance;
- **raw auto-correlations** of the low-band at each scale and of each oriented
  sub-band magnitude (central `Na×Na`);
- **magnitude cross-correlations** across orientation (cousins) and across scale
  (parents);
- **phase / real-part cross-correlations** across scale.

For the default sample (256×256, P=4, K=4, Na=7) that's ~1100 scalar constraints,
all matched against the reference.

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
