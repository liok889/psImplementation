// Bivariate dataset generation at a SET sample correlation, following the
// approach used by Rensink & Baldridge (2010) and Harrison et al. (2014)
// ("Ranking Visualizations of Correlation Using Weber's Law"): draw bivariate
// normal data and impose an exact *sample* Pearson correlation r.
//
// Method (exact in-sample):
//   1. draw x_i, y_i ~ N(0,1)
//   2. standardize x to mean 0, unit variance
//   3. residualize y on x and standardize  -> y is exactly uncorrelated with x
//   4. set  y' = r*x + sqrt(1-r^2)*y       -> corr(x, y') == r exactly
// Because x and y are standardized and orthogonal, the resulting sample
// correlation equals the target r to floating-point precision.
(function (root) {
  'use strict';

  function mean(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s / a.length; }
  function standardize(a) {
    var m = mean(a), n = a.length, v = 0;
    for (var i = 0; i < n; i++) { var d = a[i] - m; v += d * d; }
    v /= n; var sd = Math.sqrt(v) || 1;
    return a.map(function (x) { return (x - m) / sd; });
  }
  function dot(a, b) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

  // Pearson sample correlation of paired arrays.
  function pearson(x, y) {
    var n = x.length, mx = mean(x), my = mean(y), sxy = 0, sxx = 0, syy = 0;
    for (var i = 0; i < n; i++) { var dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
    var den = Math.sqrt(sxx * syy);
    return den > 0 ? sxy / den : 0;
  }

  // Generate n points [x, y] with exact sample correlation r.
  // seed: integer for reproducibility, or null/undefined for a random dataset.
  function generate(n, r, seed) {
    n = Math.max(2, n | 0);
    r = Math.max(-1, Math.min(1, r));
    var src = (seed === null || seed === undefined || seed === "")
      ? Math.random
      : d3.randomLcg((seed >>> 0) / 4294967296);  // seeded, deterministic
    var norm = d3.randomNormal.source(src)(0, 1);

    var x = new Array(n), y = new Array(n), i;
    for (i = 0; i < n; i++) { x[i] = norm(); y[i] = norm(); }
    x = standardize(x);
    // residualize y on x: b = <x,y>/<x,x>; since x is standardized, <x,x> = n
    var b = dot(x, y) / dot(x, x);
    for (i = 0; i < n; i++) y[i] = y[i] - b * x[i];
    y = standardize(y);
    var s = Math.sqrt(Math.max(0, 1 - r * r));
    var pts = new Array(n);
    for (i = 0; i < n; i++) pts[i] = [x[i], r * x[i] + s * y[i]];
    return pts;
  }

  root.CorrGen = { generate: generate, pearson: pearson };
})(typeof globalThis !== 'undefined' ? globalThis : this);
