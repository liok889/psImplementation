// Small dense linear-algebra helpers used by the synthesis "adjust_*" routines.
// Matrices are number[][] (row-major). All sizes here are tiny (<= Na*Na ~ 25),
// so clarity beats micro-optimization. These stand in for the Eigen calls in
// reference/src/constraints.cpp.
(function (root) {
  'use strict';

  function zeros(n, m) {
    m = m === undefined ? n : m;
    var A = new Array(n);
    for (var i = 0; i < n; i++) { A[i] = new Array(m); for (var j = 0; j < m; j++) A[i][j] = 0; }
    return A;
  }

  // Symmetric eigensolver via cyclic Jacobi. Returns { values, vectors } where
  // vectors[i] is the i-th eigenVECTOR as a column (vectors is V with V[r][i]),
  // and eigenvalues are sorted ascending to match Eigen's SelfAdjointEigenSolver.
  function jacobiEigen(Ain, n) {
    var A = zeros(n), V = zeros(n);
    var i, j, k;
    for (i = 0; i < n; i++) { for (j = 0; j < n; j++) A[i][j] = Ain[i][j]; V[i][i] = 1; }
    for (var sweep = 0; sweep < 100; sweep++) {
      var off = 0;
      for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) off += A[i][j] * A[i][j];
      if (off < 1e-30) break;
      for (var p = 0; p < n; p++) {
        for (var q = p + 1; q < n; q++) {
          if (Math.abs(A[p][q]) < 1e-300) continue;
          var theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
          var t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
          var c = 1 / Math.sqrt(t * t + 1), s = t * c;
          for (k = 0; k < n; k++) {
            var akp = A[k][p], akq = A[k][q];
            A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq;
          }
          for (k = 0; k < n; k++) {
            var apk = A[p][k], aqk = A[q][k];
            A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk;
          }
          for (k = 0; k < n; k++) {
            var vkp = V[k][p], vkq = V[k][q];
            V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq;
          }
        }
      }
    }
    var vals = new Array(n), idx = new Array(n);
    for (i = 0; i < n; i++) { vals[i] = A[i][i]; idx[i] = i; }
    idx.sort(function (a, b) { return vals[a] - vals[b]; });
    var values = new Array(n), vectors = zeros(n);
    for (i = 0; i < n; i++) {
      values[i] = vals[idx[i]];
      for (k = 0; k < n; k++) vectors[k][i] = V[k][idx[i]];
    }
    return { values: values, vectors: vectors };
  }

  // Solve A x = b for square A (n x n) via Gaussian elimination w/ partial pivot.
  function solve(Ain, bin, n) {
    var A = zeros(n, n + 1);
    var i, j, k;
    for (i = 0; i < n; i++) { for (j = 0; j < n; j++) A[i][j] = Ain[i][j]; A[i][n] = bin[i]; }
    for (k = 0; k < n; k++) {
      var piv = k, best = Math.abs(A[k][k]);
      for (i = k + 1; i < n; i++) if (Math.abs(A[i][k]) > best) { best = Math.abs(A[i][k]); piv = i; }
      if (piv !== k) { var tmp = A[piv]; A[piv] = A[k]; A[k] = tmp; }
      var d = A[k][k];
      if (Math.abs(d) < 1e-300) continue;
      for (i = k + 1; i < n; i++) {
        var f = A[i][k] / d;
        for (j = k; j <= n; j++) A[i][j] -= f * A[k][j];
      }
    }
    var x = new Array(n);
    for (i = n - 1; i >= 0; i--) {
      var s = A[i][n];
      for (j = i + 1; j < n; j++) s -= A[i][j] * x[j];
      x[i] = (Math.abs(A[i][i]) < 1e-300) ? 0 : s / A[i][i];
    }
    return x;
  }

  // Inverse of a square matrix via Gauss-Jordan. Returns number[][].
  function inverse(Ain, n) {
    var A = zeros(n, 2 * n), i, j, k;
    for (i = 0; i < n; i++) { for (j = 0; j < n; j++) A[i][j] = Ain[i][j]; A[i][n + i] = 1; }
    for (k = 0; k < n; k++) {
      var piv = k, best = Math.abs(A[k][k]);
      for (i = k + 1; i < n; i++) if (Math.abs(A[i][k]) > best) { best = Math.abs(A[i][k]); piv = i; }
      if (piv !== k) { var tmp = A[piv]; A[piv] = A[k]; A[k] = tmp; }
      var d = A[k][k]; if (Math.abs(d) < 1e-300) d = 1e-300;
      for (j = 0; j < 2 * n; j++) A[k][j] /= d;
      for (i = 0; i < n; i++) if (i !== k) {
        var f = A[i][k];
        for (j = 0; j < 2 * n; j++) A[i][j] -= f * A[k][j];
      }
    }
    var inv = zeros(n);
    for (i = 0; i < n; i++) for (j = 0; j < n; j++) inv[i][j] = A[i][n + j];
    return inv;
  }

  // Real matrix product C = A(n x m) * B(m x p)
  function matMul(A, B, n, m, p) {
    var C = zeros(n, p);
    for (var i = 0; i < n; i++) for (var k = 0; k < m; k++) {
      var a = A[i][k]; if (a === 0) continue;
      for (var j = 0; j < p; j++) C[i][j] += a * B[k][j];
    }
    return C;
  }
  function transpose(A, n, m) {
    var T = zeros(m, n);
    for (var i = 0; i < n; i++) for (var j = 0; j < m; j++) T[j][i] = A[i][j];
    return T;
  }

  // Evaluate polynomial sum_i c[i] x^i (low-to-high coefficients).
  function polyEval(c, x) {
    var r = 0;
    for (var i = c.length - 1; i >= 0; i--) r = r * x + c[i];
    return r;
  }

  // Real roots... general complex roots of a polynomial with real coeffs given
  // low-to-high. Uses Durand-Kerner. Returns array of {re, im} of length `deg`.
  function polyRoots(coeffs) {
    // strip leading (highest) zero coefficients
    var c = coeffs.slice();
    while (c.length > 1 && Math.abs(c[c.length - 1]) < 1e-300) c.pop();
    var deg = c.length - 1;
    if (deg <= 0) return [];
    // normalize to monic
    var lead = c[deg];
    var a = c.map(function (v) { return v / lead; }); // a[0..deg], a[deg]=1
    // initial guesses: powers of 0.4+0.9i
    var roots = [];
    var br = 0.4, bi = 0.9, pr = 1, pi = 0;
    for (var i = 0; i < deg; i++) {
      roots.push({ re: pr, im: pi });
      var npr = pr * br - pi * bi, npi = pr * bi + pi * br; pr = npr; pi = npi;
    }
    function evalC(zr, zi) { // Horner with complex z, real coeffs a
      var rr = a[deg], ri = 0;
      for (var k = deg - 1; k >= 0; k--) {
        var nr = rr * zr - ri * zi + a[k];
        var ni = rr * zi + ri * zr;
        rr = nr; ri = ni;
      }
      return [rr, ri];
    }
    for (var iter = 0; iter < 200; iter++) {
      var maxd = 0;
      for (i = 0; i < deg; i++) {
        var zr = roots[i].re, zi = roots[i].im;
        var f = evalC(zr, zi);
        // denominator = prod_{j!=i} (z_i - z_j)
        var dr = 1, di = 0;
        for (var j = 0; j < deg; j++) {
          if (j === i) continue;
          var er = zr - roots[j].re, ei = zi - roots[j].im;
          var nr = dr * er - di * ei, ni = dr * ei + di * er; dr = nr; di = ni;
        }
        var den2 = dr * dr + di * di; if (den2 < 1e-300) den2 = 1e-300;
        // delta = f / den
        var qr = (f[0] * dr + f[1] * di) / den2;
        var qi = (f[1] * dr - f[0] * di) / den2;
        roots[i].re -= qr; roots[i].im -= qi;
        maxd = Math.max(maxd, Math.abs(qr) + Math.abs(qi));
      }
      if (maxd < 1e-14) break;
    }
    return roots;
  }

  root.PS = root.PS || {};
  root.PS.LinAlg = {
    zeros: zeros, jacobiEigen: jacobiEigen, solve: solve, inverse: inverse,
    matMul: matMul, transpose: transpose, polyEval: polyEval, polyRoots: polyRoots
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PS.LinAlg;
})(typeof globalThis !== 'undefined' ? globalThis : this);
