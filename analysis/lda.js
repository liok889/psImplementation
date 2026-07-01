// lda.js — regularized (shrinkage) Linear Discriminant Analysis for the
// two-class correlation-discrimination problem.
//
// The feature vectors are wide (up to 2*1270 = 2540 dims in concat mode) relative
// to the number of training pairs, so the raw pooled within-class covariance is
// ill-conditioned / rank-deficient. We therefore (a) standardize each feature,
// (b) drop features with essentially zero variance, and (c) shrink the covariance
// toward a scaled identity (Ledoit-Wolf-style) before solving for the LDA
// direction w = Σ⁻¹(μ₁ − μ₀). A 'diagonal' covariance mode is also provided: it
// ignores feature correlations (naive-Gaussian / diagonal LDA), which is O(n·d)
// instead of O(n·d²) and is a robust fast default for very wide inputs.
//
// UMD-style: attaches to a global `PSLDA` (browser / worker / jsc).
(function (root) {
  'use strict';

  // Cholesky factorization of a symmetric positive-definite matrix A (d×d,
  // row-major Float64Array). Overwrites the lower triangle of A with L (A = LLᵀ).
  // Returns false if A is not positive definite (shouldn't happen after shrinkage).
  function cholesky(A, d) {
    for (var j = 0; j < d; j++) {
      var sum = A[j * d + j];
      for (var k = 0; k < j; k++) { var ljk = A[j * d + k]; sum -= ljk * ljk; }
      if (sum <= 0) return false;
      var ljj = Math.sqrt(sum);
      A[j * d + j] = ljj;
      for (var i = j + 1; i < d; i++) {
        var s = A[i * d + j];
        for (var k2 = 0; k2 < j; k2++) s -= A[i * d + k2] * A[j * d + k2];
        A[i * d + j] = s / ljj;
      }
    }
    return true;
  }

  // Solve A x = b given the Cholesky factor L stored in the lower triangle of A.
  function cholSolve(A, d, b) {
    var x = new Float64Array(d);
    // Forward solve L y = b.
    for (var i = 0; i < d; i++) {
      var s = b[i];
      for (var k = 0; k < i; k++) s -= A[i * d + k] * x[k];
      x[i] = s / A[i * d + i];
    }
    // Back solve Lᵀ x = y.
    for (var i2 = d - 1; i2 >= 0; i2--) {
      var s2 = x[i2];
      for (var k2 = i2 + 1; k2 < d; k2++) s2 -= A[k2 * d + i2] * x[k2];
      x[i2] = s2 / A[i2 * d + i2];
    }
    return x;
  }

  // Train a shrinkage LDA.
  //   X: Float64Array(n*D) row-major features; y: Int8Array(n) in {0,1}.
  //   opts.shrinkage: λ in [0,1] toward scaled identity (default 0.2).
  //   opts.covariance: 'full' (default) or 'diagonal'.
  //   opts.varThresh: features with variance below this are dropped (default 1e-12).
  //   opts.progress: optional callback(fraction, message).
  // Returns a model usable by score()/predict().
  function train(X, y, n, D, opts) {
    opts = opts || {};
    var lambda = (opts.shrinkage == null) ? 0.2 : opts.shrinkage;
    var covMode = opts.covariance || 'full';
    var varThresh = (opts.varThresh == null) ? 1e-12 : opts.varThresh;
    var progress = opts.progress || function () {};

    // --- 1. per-feature mean / std over all n rows ---
    var mean = new Float64Array(D), M2 = new Float64Array(D);
    for (var i = 0; i < n; i++) {
      var base = i * D;
      for (var j = 0; j < D; j++) {
        var v = X[base + j];
        var delta = v - mean[j];
        mean[j] += delta / (i + 1);
        M2[j] += delta * (v - mean[j]);
      }
    }
    var std = new Float64Array(D);
    var keep = [];
    for (var j2 = 0; j2 < D; j2++) {
      var variance = M2[j2] / (n - 1);
      std[j2] = Math.sqrt(variance);
      if (variance > varThresh) keep.push(j2);
    }
    var d = keep.length;
    if (d === 0) throw new Error('all features are constant — nothing to fit');
    progress(0.1, 'standardized ' + D + ' features, kept ' + d + ' with variance');

    // --- 2. standardized, feature-selected matrix Z (n×d) ---
    var Z = new Float64Array(n * d);
    for (var i2 = 0; i2 < n; i2++) {
      var bIn = i2 * D, bOut = i2 * d;
      for (var jj = 0; jj < d; jj++) {
        var col = keep[jj];
        Z[bOut + jj] = (X[bIn + col] - mean[col]) / std[col];
      }
    }

    // --- 3. class means and counts (in standardized space) ---
    var m0 = new Float64Array(d), m1 = new Float64Array(d);
    var n0 = 0, n1 = 0;
    for (var i3 = 0; i3 < n; i3++) {
      var b3 = i3 * d, tgt = y[i3] ? m1 : m0;
      for (var jj3 = 0; jj3 < d; jj3++) tgt[jj3] += Z[b3 + jj3];
      if (y[i3]) n1++; else n0++;
    }
    if (n0 === 0 || n1 === 0) throw new Error('training data has only one class');
    for (var jj4 = 0; jj4 < d; jj4++) { m0[jj4] /= n0; m1[jj4] /= n1; }

    // mean difference (the LDA target vector)
    var mdiff = new Float64Array(d);
    for (var jj5 = 0; jj5 < d; jj5++) mdiff[jj5] = m1[jj5] - m0[jj5];

    var w;
    if (covMode === 'diagonal') {
      // Pooled within-class variance per feature; shrink toward the mean variance.
      var pvar = new Float64Array(d);
      for (var i4 = 0; i4 < n; i4++) {
        var b4 = i4 * d, mc = y[i4] ? m1 : m0;
        for (var jj6 = 0; jj6 < d; jj6++) { var e = Z[b4 + jj6] - mc[jj6]; pvar[jj6] += e * e; }
      }
      var denom = n - 2;
      var gamma = 0;
      for (var jj7 = 0; jj7 < d; jj7++) { pvar[jj7] /= denom; gamma += pvar[jj7]; }
      gamma /= d;
      w = new Float64Array(d);
      for (var jj8 = 0; jj8 < d; jj8++) {
        var sv = (1 - lambda) * pvar[jj8] + lambda * gamma;
        w[jj8] = mdiff[jj8] / sv;
      }
      progress(0.85, 'solved diagonal LDA (d=' + d + ')');
    } else {
      // Full pooled within-class covariance via the Gram trick:
      //   S_W = Σ_i z_i z_iᵀ − n0 m0 m0ᵀ − n1 m1 m1ᵀ,  Σ = S_W / (n-2).
      progress(0.15, 'accumulating ' + d + '×' + d + ' covariance…');
      var S = new Float64Array(d * d);
      for (var i5 = 0; i5 < n; i5++) {
        var b5 = i5 * d;
        for (var a = 0; a < d; a++) {
          var za = Z[b5 + a];
          if (za === 0) continue;
          var rowA = a * d;
          for (var bb = a; bb < d; bb++) S[rowA + bb] += za * Z[b5 + bb];
        }
        if ((i5 & 255) === 0) progress(0.15 + 0.55 * (i5 / n), 'covariance ' + i5 + '/' + n);
      }
      var denomF = n - 2;
      var gammaF = 0;
      for (var a2 = 0; a2 < d; a2++) {
        for (var b6 = a2; b6 < d; b6++) {
          var val = (S[a2 * d + b6] - n0 * m0[a2] * m0[b6] - n1 * m1[a2] * m1[b6]) / denomF;
          S[a2 * d + b6] = val;
          if (a2 !== b6) S[b6 * d + a2] = val; // mirror to full symmetric matrix
        }
        gammaF += S[a2 * d + a2];
      }
      gammaF /= d;
      // Shrink toward gammaF·I:  Σ_λ = (1-λ)Σ + λ·gammaF·I.
      progress(0.72, 'shrinking (λ=' + lambda + ') and factorizing…');
      for (var a3 = 0; a3 < d * d; a3++) S[a3] *= (1 - lambda);
      for (var a4 = 0; a4 < d; a4++) S[a4 * d + a4] += lambda * gammaF;
      if (!cholesky(S, d)) throw new Error('covariance not positive definite even after shrinkage — increase shrinkage');
      w = cholSolve(S, d, mdiff);
      progress(0.9, 'solved full LDA (d=' + d + ')');
    }

    // --- 4. bias: LDA discriminant g(z) = wᵀz − 0.5 wᵀ(m0+m1) + ln(n1/n0) ---
    var mid = 0;
    for (var jj9 = 0; jj9 < d; jj9++) mid += w[jj9] * (m0[jj9] + m1[jj9]);
    var b = -0.5 * mid + Math.log(n1 / n0);

    return {
      keep: keep, mean: mean, std: std, w: w, b: b,
      d: d, D: D, covariance: covMode, shrinkage: lambda,
      n0: n0, n1: n1
    };
  }

  // Signed discriminant score for one raw feature row (Float64Array length D).
  // Predict class 1 when score > 0.
  function score(model, xRow) {
    var s = model.b, keep = model.keep, w = model.w, mean = model.mean, std = model.std;
    for (var jj = 0; jj < model.d; jj++) {
      var col = keep[jj];
      s += w[jj] * ((xRow[col] - mean[col]) / std[col]);
    }
    return s;
  }

  function predict(model, xRow) { return score(model, xRow) > 0 ? 1 : 0; }

  // Evaluate a model on a feature set, returning overall accuracy and a
  // per-rbase breakdown. X/y/rbase as produced by PSData.buildPairs.
  function evaluate(model, X, y, rbase, n, D) {
    var correct = 0;
    var byR = new Map(); // rbase -> {n, correct}
    for (var i = 0; i < n; i++) {
      // score inline over this row
      var s = model.b, keep = model.keep, w = model.w, mean = model.mean, std = model.std, base = i * D;
      for (var jj = 0; jj < model.d; jj++) {
        var col = keep[jj];
        s += w[jj] * ((X[base + col] - mean[col]) / std[col]);
      }
      var pred = s > 0 ? 1 : 0;
      var ok = (pred === y[i]) ? 1 : 0;
      correct += ok;
      var key = rbase[i];
      var e = byR.get(key);
      if (!e) { e = { n: 0, correct: 0 }; byR.set(key, e); }
      e.n++; e.correct += ok;
    }
    var levels = Array.from(byR.keys()).sort(function (p, q) { return p - q; });
    var byRbase = levels.map(function (k) {
      var e = byR.get(k);
      return { rbase: k, n: e.n, correct: e.correct, accuracy: e.correct / e.n };
    });
    return { accuracy: correct / n, n: n, correct: correct, byRbase: byRbase };
  }

  var api = { train: train, score: score, predict: predict, evaluate: evaluate, cholesky: cholesky, cholSolve: cholSolve };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PSLDA = api;
})(typeof self !== 'undefined' ? self : this);
