// Statistic computations, ported from reference/src/constraints.cpp.
// These are the "compute_*" routines used during analysis (NOT the synthesis
// "adjust_*" routines, which live in adjust.js).
(function (root) {
  'use strict';
  var FFT = root.PS.FFT;

  function mean(data, N, off) {
    off = off || 0;
    var m = 0.0;
    for (var i = 0; i < N; i++) m += data[off + i];
    return m / N;
  }

  // central moment of given order about m (Eq. 39).
  function computeMoment(data, m, order, N, off) {
    off = off || 0;
    var moment = 0.0;
    for (var i = 0; i < N; i++) {
      var tmp = 1.0, d = data[off + i] - m;
      for (var j = 0; j < order; j++) tmp *= d;
      moment += tmp;
    }
    return moment / N;
  }

  function computeSkewness(data, m, varv, N, off) {
    var o3 = computeMoment(data, m, 3, N, off);
    return (varv > 0) ? o3 / Math.sqrt(varv * varv * varv) : 0;
  }
  function computeKurtosis(data, m, varv, N, off) {
    var o4 = computeMoment(data, m, 4, N, off);
    return (varv > 0) ? o4 / (varv * varv) : 3;
  }
  function minAndMax(data, N, off) {
    off = off || 0;
    var mn = data[off], mx = data[off];
    for (var i = 1; i < N; i++) {
      var v = data[off + i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    return [mn, mx];
  }

  // Integer shift with periodic boundary: out(i,j) = in(i-ofx, j-ofy).
  function shift(out, inp, ofx, ofy, nx, ny, nz) {
    for (var j = 0; j < ny; j++) {
      var j2 = ((j - ofy) % ny + ny) % ny;
      for (var i = 0; i < nx; i++) {
        var i2 = ((i - ofx) % nx + nx) % nx;
        for (var l = 0; l < nz; l++)
          out[i + j * nx + l * nx * ny] = inp[i2 + j2 * nx + l * nx * ny];
      }
    }
  }

  // Central Na x Na auto-correlation (Eq. 42). Input assumed zero-mean.
  // Writes into Ac (length Na*Na*nz), index i + j*Na + l*Na*Na.
  function computeAutoCor(Ac, inp, nx, ny, nz, Na) {
    var N = nx * ny;
    var fftC = FFT.allocComplex(N * nz);
    var full = new Float64Array(N * nz);
    FFT.fftReal(fftC, inp, nx, ny, nz);
    for (var i = 0; i < N * nz; i++) {
      fftC.re[i] = fftC.re[i] * fftC.re[i] + fftC.im[i] * fftC.im[i];
      fftC.im[i] = 0;
    }
    FFT.ifftReal(full, fftC, nx, ny, nz);
    var hNa = ((Na - 1) / 2) | 0;
    var ifactor = 1.0 / N;
    for (var a = 0; a < Na; a++) {
      for (var b = 0; b < Na; b++) {
        var ind;
        if (a < hNa && b < hNa) ind = nx - hNa + a + (ny - hNa + b) * nx;
        else if (a < hNa && b > hNa - 1) ind = nx - hNa + a + (b - hNa) * nx;
        else if (a > hNa - 1 && b < hNa) ind = a - hNa + (ny - hNa + b) * nx;
        else ind = a - hNa + (b - hNa) * nx;
        for (var l = 0; l < nz; l++)
          Ac[a + b * Na + l * Na * Na] = full[ind + l * N] * ifactor;
      }
    }
  }

  // Build the (N_data*nz) rows view: rows[i + l*N_data] -> { arr, off } over data[i] at l*N.
  // Pairwise cross-correlation matrix (Eq. 43): out[j + i*D] = (M M^T / N)[i][j], D=N_data*nz.
  function computeCrossCor(out, data, N_data, N, nz) {
    var D = N_data * nz;
    // gather rows as {arr, off}
    var rows = new Array(D);
    for (var l = 0; l < nz; l++)
      for (var i = 0; i < N_data; i++)
        rows[i + l * N_data] = { arr: data[i], off: l * N };
    for (var a = 0; a < D; a++) {
      var ra = rows[a].arr, oa = rows[a].off;
      for (var b = a; b < D; b++) {
        var rb = rows[b].arr, ob = rows[b].off;
        var s = 0.0;
        for (var n = 0; n < N; n++) s += ra[oa + n] * rb[ob + n];
        s /= N;
        out[b + a * D] = s;
        out[a + b * D] = s;
      }
    }
  }

  // Cross-correlation between two band lists (Eq. 44):
  // out[j + i*(N_data2*nz)] = (X Y^T / N)[i][j].
  function computeCrossScaleCor(out, data1, data2, N_data1, N_data2, N, nz) {
    var D1 = N_data1 * nz, D2 = N_data2 * nz;
    var rows1 = new Array(D1), rows2 = new Array(D2);
    var l, i;
    for (l = 0; l < nz; l++) {
      for (i = 0; i < N_data1; i++) rows1[i + l * N_data1] = { arr: data1[i], off: l * N };
      for (i = 0; i < N_data2; i++) rows2[i + l * N_data2] = { arr: data2[i], off: l * N };
    }
    for (var a = 0; a < D1; a++) {
      var ra = rows1[a].arr, oa = rows1[a].off;
      for (var b = 0; b < D2; b++) {
        var rb = rows2[b].arr, ob = rows2[b].off;
        var s = 0.0;
        for (var n = 0; n < N; n++) s += ra[oa + n] * rb[ob + n];
        out[b + a * D2] = s / N;
      }
    }
  }

  root.PS = root.PS || {};
  root.PS.Stats = {
    mean: mean, computeMoment: computeMoment, computeSkewness: computeSkewness,
    computeKurtosis: computeKurtosis, minAndMax: minAndMax, shift: shift,
    computeAutoCor: computeAutoCor, computeCrossCor: computeCrossCor,
    computeCrossScaleCor: computeCrossScaleCor
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PS.Stats;
})(typeof globalThis !== 'undefined' ? globalThis : this);
