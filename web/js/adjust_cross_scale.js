// adjust_cross_scale_cor (Algorithm 10), ported from constraints.cpp.
// Linearly adjusts data1 to impose pairwise cross-correlation `crossCor` AND
// cross-scale correlation `crossScaleCor` with the fixed bands data2.
// Involves complex matrices (eigenvalue square roots may be imaginary), so this
// uses small complex matrix helpers. data2 is not modified.
(function (root) {
  'use strict';
  var L = root.PS.LinAlg;

  function czeros(n, m) { m = m === undefined ? n : m; return { re: L.zeros(n, m), im: L.zeros(n, m) }; }
  // complex * complex (n x m)*(m x p)
  function cmm(A, B, n, m, p) {
    var C = czeros(n, p);
    for (var i = 0; i < n; i++) for (var k = 0; k < m; k++) {
      var ar = A.re[i][k], ai = A.im[i][k];
      if (ar === 0 && ai === 0) continue;
      for (var j = 0; j < p; j++) {
        C.re[i][j] += ar * B.re[k][j] - ai * B.im[k][j];
        C.im[i][j] += ar * B.im[k][j] + ai * B.re[k][j];
      }
    }
    return C;
  }
  // complex * real
  function cmr(A, B, n, m, p) {
    var C = czeros(n, p);
    for (var i = 0; i < n; i++) for (var k = 0; k < m; k++) {
      var ar = A.re[i][k], ai = A.im[i][k];
      for (var j = 0; j < p; j++) { C.re[i][j] += ar * B[k][j]; C.im[i][j] += ai * B[k][j]; }
    }
    return C;
  }
  function csqrt(x) { // principal sqrt of real x as complex
    return x >= 0 ? { re: Math.sqrt(x), im: 0 } : { re: 0, im: Math.sqrt(-x) };
  }
  function cinvsqrt(x) { // 1/sqrt(real x) as complex (principal)
    if (x > 0) return { re: 1 / Math.sqrt(x), im: 0 };
    return { re: 0, im: -1 / Math.sqrt(-x) };
  }

  function rmrT(A, B, N) { // (A B^T)/N for real A,B both (rows x N)
    var nA = A.length, nB = B.length, C = L.zeros(nA, nB);
    for (var i = 0; i < nA; i++) for (var j = 0; j < nB; j++) {
      var s = 0; for (var n = 0; n < N; n++) s += A[i][n] * B[j][n]; C[i][j] = s / N;
    }
    return C;
  }

  function adjustCrossScaleCor(data1, data2, crossCor, crossScaleCor, N_data1, N_data2, N, nz) {
    var D1 = N_data1 * nz, D2 = N_data2 * nz;
    var tol = (nz === 3) ? 1e-3 : 1e-6;
    var i, j, l, k;

    var V = L.zeros(D1, N), W = L.zeros(D2, N);
    for (l = 0; l < nz; l++) {
      for (i = 0; i < N_data1; i++) { var r1 = V[i + l * N_data1], s1 = data1[i], o1 = l * N; for (j = 0; j < N; j++) r1[j] = s1[o1 + j]; }
      for (i = 0; i < N_data2; i++) { var r2 = W[i + l * N_data2], s2 = data2[i], o2 = l * N; for (j = 0; j < N; j++) r2[j] = s2[o2 + j]; }
    }
    var tildeC = L.zeros(D1), tildeD = L.zeros(D1, D2);
    for (i = 0; i < D1; i++) for (j = 0; j < D1; j++) tildeC[i][j] = crossCor[j + i * D1];
    for (i = 0; i < D1; i++) for (j = 0; j < D2; j++) tildeD[i][j] = crossScaleCor[j + i * D2];

    var C = rmrT(V, V, N);          // D1 x D1
    var Dm = rmrT(V, W, N);         // D1 x D2
    var E = rmrT(W, W, N);          // D2 x D2
    var invE = L.inverse(E, D2);
    // F = C - Dm invE Dm^T ; tildeF = tildeC - tildeD invE tildeD^T
    var DmT = L.transpose(Dm, D1, D2), tildeDT = L.transpose(tildeD, D1, D2);
    var F = subMat(C, L.matMul(L.matMul(Dm, invE, D1, D2, D2), DmT, D1, D2, D1), D1);
    var tildeF = subMat(tildeC, L.matMul(L.matMul(tildeD, invE, D1, D2, D2), tildeDT, D1, D2, D1), D1);

    var ein = L.jacobiEigen(F, D1), eout = L.jacobiEigen(tildeF, D1);
    var isD = new Array(D1), sD = new Array(D1), test = false;
    for (i = 0; i < D1; i++) {
      isD[i] = { re: 0, im: 0 };
      if (Math.abs(ein.values[i]) > 1e-12) { isD[i] = cinvsqrt(ein.values[i]); test = true; }
      sD[i] = csqrt(eout.values[i]);
    }
    if (!test) return;

    // G = Pin diag(isD) Pin^T  (complex);  M1 = Pout diag(sD) Pout^T (complex)
    var G = czeros(D1), M1 = czeros(D1);
    for (i = 0; i < D1; i++) for (j = 0; j < D1; j++) {
      var gr = 0, gi = 0, mr = 0, mi = 0;
      for (k = 0; k < D1; k++) {
        var pin = ein.vectors[i][k] * ein.vectors[j][k];
        gr += pin * isD[k].re; gi += pin * isD[k].im;
        var pout = eout.vectors[i][k] * eout.vectors[j][k];
        mr += pout * sD[k].re; mi += pout * sD[k].im;
      }
      G.re[i][j] = gr; G.im[i][j] = gi; M1.re[i][j] = mr; M1.im[i][j] = mi;
    }
    var Lambda = cmm(M1, G, D1, D1, D1);                       // complex D1 x D1
    // Sigma = (tildeD - Lambda*Dm) * invE   (complex)
    var LD = cmr(Lambda, Dm, D1, D1, D2);
    var diff = czeros(D1, D2);
    for (i = 0; i < D1; i++) for (j = 0; j < D2; j++) { diff.re[i][j] = tildeD[i][j] - LD.re[i][j]; diff.im[i][j] = -LD.im[i][j]; }
    var Sigma = cmr(diff, invE, D1, D2, D2);                   // complex D1 x D2

    // Vnew = Lambda*V + Sigma*W  (real V,W). Compute real & imag parts.
    var reOut = L.zeros(D1, N), imOut = L.zeros(D1, N);
    for (i = 0; i < D1; i++) {
      var ro = reOut[i], io = imOut[i];
      for (k = 0; k < D1; k++) {
        var lr = Lambda.re[i][k], li = Lambda.im[i][k], vk = V[k];
        if (lr !== 0 || li !== 0) for (j = 0; j < N; j++) { ro[j] += lr * vk[j]; io[j] += li * vk[j]; }
      }
      for (k = 0; k < D2; k++) {
        var sr = Sigma.re[i][k], si = Sigma.im[i][k], wk = W[k];
        if (sr !== 0 || si !== 0) for (j = 0; j < N; j++) { ro[j] += sr * wk[j]; io[j] += si * wk[j]; }
      }
    }
    // per channel: variance test then write real part back
    for (l = 0; l < nz; l++) {
      var mr2 = 0, mi2 = 0, cnt = N_data1 * N;
      for (i = 0; i < N_data1; i++) { var ri = i + l * N_data1; for (j = 0; j < N; j++) { mr2 += reOut[ri][j]; mi2 += imOut[ri][j]; } }
      mr2 /= cnt; mi2 /= cnt;
      var vr = 0, vi = 0;
      for (i = 0; i < N_data1; i++) { var ri2 = i + l * N_data1; for (j = 0; j < N; j++) { var dr = reOut[ri2][j] - mr2, di = imOut[ri2][j] - mi2; vr += dr * dr; vi += di * di; } }
      if (vi / vr < tol) {
        for (i = 0; i < N_data1; i++) { var dst = data1[i], doff = l * N, src = reOut[i + l * N_data1]; for (j = 0; j < N; j++) dst[doff + j] = src[j]; }
      }
    }
  }

  function subMat(A, B, n) { var C = L.zeros(n); for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) C[i][j] = A[i][j] - B[i][j]; return C; }

  root.PS = root.PS || {};
  root.PS.Adjust = root.PS.Adjust || {};
  root.PS.Adjust.adjustCrossScaleCor = adjustCrossScaleCor;
  if (typeof module !== 'undefined' && module.exports) module.exports = adjustCrossScaleCor;
})(typeof globalThis !== 'undefined' ? globalThis : this);
