# Correlation-discrimination classifier (PS-statistics LDA)

An analysis pipeline + browser interface that trains a **linear discriminant
analysis (LDA)** model to predict, given a *pair* of visualizations each
described by its **Portilla–Simoncelli summary statistics**, which of the two has
the **higher correlation**.

The inputs are the CSV stimulus sets produced by the `correlation_percepts`
generator: one visualization per row, two consecutive rows per *stimulus*, both
rows sharing an `rbase` (0.2, 0.3, …) with one row at `r == rbase` and the other
offset slightly above or below.

## Files

| File | Role |
|------|------|
| `index.html` | The interface — pick a training CSV and a test CSV, choose options, train, and see accuracy across `rbase`. |
| `app.js` | UI glue: file pickers, options, progress, and the inline-SVG accuracy chart. |
| `worker.js` | Web Worker — reads the CSVs (`FileReaderSync`), builds features, trains and evaluates off the UI thread. |
| `psdata.js` | CSV parsing, stimulus pairing, and feature construction (browser / worker / `jsc`). |
| `lda.js` | Standardization, variance filtering, and regularized LDA (full or diagonal covariance). |
| `selftest.js` | Headless validation under JavaScriptCore `jsc` (see below). |

`psdata.js` and `lda.js` are UMD-style (attach to globals `PSData` / `PSLDA`), so
the exact code that trains in the browser also runs headless under `jsc`.

## Running the interface

The pages must be served over HTTP (Web Workers don't run from `file://`):

```bash
python3 -m http.server        # from the repo root
# then open http://localhost:8000/analysis/
```

1. Choose a **training CSV** and a **test CSV** (two different stimulus sets).
2. Pick the model options (defaults are fine).
3. **Train & evaluate.** Results show overall test/train accuracy and a plot of
   accuracy vs. `rbase`, with a per-`rbase` table.

## What the classifier sees

For each stimulus (a pair of plots) we build one feature vector from the two
plots' PS statistics — every statistic from `pixel.min` through the last column
(1270 statistics per plot). The label is **which plot is more strongly
correlated** (larger `|r|` — equivalent to "higher `r`" for positive-only sets,
and correct for negative sets too).

Stimuli are paired by `(participant, stimulus)`. The generator writes an optional
`participant` column right after `stimulus` (a replication of the full design per
participant, with `stimulus` restarting at 1 for each). Older CSVs without that
column are treated as a single participant `1`, so they load unchanged.

**Training flattens across participants**: every pair — regardless of which
participant it came from — is one independent training example. The `participant`
field is used only to pair the two plots correctly and to pass through to the test
side. On the **test** set, participant is carried into every per-stimulus call
(below) and, when the test set has more than one participant, the results panel
also shows a **per-participant accuracy** table alongside the aggregate.

### Feature construction (the `Feature construction` control)

- **Concatenate** (default, the requested configuration): the feature is
  `[ slot0 PS stats , slot1 PS stats ]` — both plots' full statistic vectors,
  `2 × 1270 = 2540` dimensions.
- **Difference** (recommended safeguard): the feature is `slot0 − slot1` per
  statistic (1270 dimensions).

### Preventing the model from learning left/right

The label we care about is *which plot is more correlated*, **not** which screen
side it was shown on. Two safeguards keep the model honest:

1. **Randomized slot assignment.** For every pair we randomly (seeded, so it's
   reproducible) assign the two plots to "slot 0" / "slot 1" of the feature
   vector, independently of the CSV's `left_or_right` column, and set the label to
   `1` if slot 0 is the more strongly correlated plot. Because the assignment is random, the label
   is ~50/50 balanced and carries no positional information — the model can only
   succeed by reading the PS statistics. (The reported "labels … balanced"
   figure confirms this, ≈ 0.50.) The `left_or_right` column is **never** a
   feature.

2. **Difference mode (the stronger, suggested alternative).** With
   `slot0 − slot1` features the representation is *antisymmetric*: swapping the
   two plots negates both the feature vector and the label, so the decision
   boundary is forced through the origin and there is literally no left/right
   identity for the model to encode. It's also half the dimensionality (~2×
   faster) and empirically matches concat accuracy. Use it when you want a
   provable guarantee that only the statistical contrast drives the prediction.

## The model

Regularized (shrinkage) LDA: features are z-scored on the training set,
zero-variance features are dropped, and the pooled within-class covariance is
shrunk toward a scaled identity (`Σλ = (1−λ)Σ + λ·γ·I`) before solving
`w = Σ⁻¹(μ₁ − μ₀)` via Cholesky. This is necessary because the feature space is
wide relative to the number of pairs.

- **Full covariance** models correlations between statistics. PS statistics are
  strongly correlated, so this is where the signal is — but it's `O(d³)`
  (concat ≈ 1–2 min, difference ≈ 20–40 s).
- **Diagonal covariance** ignores those correlations; near-instant, but markedly
  less accurate here.

## Command-line tool (`cli/lda_analyze`, Node.js)

The headless counterpart of the browser tool — same analysis, no browser:

```bash
analysis/cli/lda_analyze --train train.csv --test test.csv --out calls.csv
```

It trains the LDA, prints accuracy to **stdout** (overall test/train, a per-`rbase`
table, and — when the test set has >1 participant — a per-participant table), and
writes the per-trial TEST calls (Harrison format, below) to `--out`. Flags
(defaults in brackets): `--mode concat|difference` [concat], `--covariance
full|diagonal` [full], `--shrinkage L` [0.2], `--seed N` [1], `--out FILE`
[per_trial_test.csv], `--train-out FILE` [none], `-h`/`--help`. It reuses the same
`psdata.js`/`lda.js` as the browser, so results match (e.g. difference/full ≈ 86%
test on the bundled sets). Progress goes to stderr.

## Per-stimulus output (for JND fitting)

Besides the accuracy chart, the results panel offers **per-stimulus calls** for the
test and train sets as CSVs, in the **Harrison et al.** column format so they can
feed the same per-participant JND-fitting pipeline as the empirical data:

```
rbase,rv,approach,correctChoice,currentChoice,gotItRight,index,jnd,participant,vis,rdirection
```

- `rbase` / `rv` — the pair's base correlation and the comparison plot's
  correlation, as magnitudes (sign carried by `rdirection`).
- `approach` — `below`/`above` (is `rv` below or above `rbase`).
- `correctChoice` — the `L`/`R` side that is actually more correlated.
- `currentChoice` — the side the **model** picked (its slot prediction mapped back
  to the original left/right; the training-time slot randomization does not affect
  this reporting).
- `gotItRight` — `true`/`false`; its mean equals the reported accuracy.
- `index` — 0-based trial counter within each participant.
- `jnd` — left **blank**, to be fitted per participant downstream.
- `participant`, `vis`, `rdirection` — carried through from the stimulus set.

The **test** CSV is the model's out-of-sample behaviour; the **train** CSV is
in-sample. Fit a psychometric function per `participant` (× `rbase`) to get JNDs.

## Headless validation (`jsc`)

```bash
jsc analysis/psdata.js analysis/lda.js analysis/selftest.js
```

Loads the real `training_scatterplot.csv` / `test_scatterplot.csv`, runs the four
mode × covariance combinations, and prints overall + per-`rbase` accuracy with
timings. Representative test accuracy on the bundled scatterplot sets:

| mode | covariance | test acc | train time |
|------|-----------|---------:|-----------:|
| concat | diagonal | ~67% | <0.1 s |
| difference | diagonal | ~68% | <0.1 s |
| difference | full | **~86%** | ~22 s |
| concat | full | ~85% | ~90 s |

Accuracy rises monotonically with `rbase` (e.g. ~74–77% at `rbase = 0.2` up to
~91% at `rbase = 0.8` for full covariance) — discrimination is harder for
low-correlation blobs and easier for tight, high-correlation plots.
