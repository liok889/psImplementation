// Statistic-adjustment routines for synthesis, ported from
// reference/src/constraints.cpp (Appendix A). Grayscale-oriented (nz handled
// generally where cheap). These modify image data in place to impose target
// statistics. Uses PS.LinAlg for eigen / solve / polynomial roots and PS.FFT.
(function (root) {
  'use strict';
  var FFT = root.PS.FFT, S = root.PS.Stats, L = root.PS.LinAlg;

  // --- marginal statistics ---

  function adjustRange(data, m, M, N, off) {
    off = off || 0;
    for (var i = 0; i < N; i++) {
      var v = data[off + i];
      if (v < m) data[off + i] = m; else if (v > M) data[off + i] = M;
    }
  }

  function adjustMeanVariance(data, meanOut, varOut, N, off) {
    off = off || 0;
    var m = S.mean(data, N, off);
    var varIn = S.computeMoment(data, m, 2, N, off);
    var factor = (varIn > 0) ? Math.sqrt(varOut / varIn) : 1;
    for (var i = 0; i < N; i++) data[off + i] = factor * (data[off + i] - m) + meanOut;
  }

  function realRoots(coeffs) {
    var r = L.polyRoots(coeffs), out = [];
    for (var i = 0; i < r.length; i++) {
      var re = r[i].re;
      if (re !== 0 && Math.abs(r[i].im / re) < 1e-6) out.push(re);
      else if (re === 0 && Math.abs(r[i].im) < 1e-9) out.push(0);
    }
    return out;
  }

  // Adjust skewness (Algorithm 6). data assumed zero mean over [off, off+N).
  function adjustSkewness(data, skOut, N, off) {
    off = off || 0;
    var m2 = 0, m3 = 0, m4 = 0, m5 = 0, m6 = 0;
    for (var i = 0; i < N; i++) {
      var x = data[off + i], t = x * x; m2 += t; t *= x; m3 += t; t *= x; m4 += t;
      t *= x; m5 += t; t *= x; m6 += t;
    }
    var inv = 1 / N; m2 *= inv; m3 *= inv; m4 *= inv; m5 *= inv; m6 *= inv;
    var std = Math.sqrt(m2), skIn = m3 / (std * std * std);
    var snr = 20 * Math.log(Math.abs(skOut / (skOut - skIn))) / Math.LN10;
    if (snr > 60) return;

    var p0 = skIn * m2 * std;
    var p1 = 3 * (m4 - m2 * m2 * (1 + skIn * skIn));
    var p2 = 3 * (m5 - 2 * std * skIn * m4 + m2 * m2 * std * skIn * skIn * skIn);
    var p3 = m6 - 3 * std * skIn * m5 + 3 * m2 * (skIn * skIn - 1) * m4 +
             m2 * m2 * m2 * (2 + 3 * skIn * skIn - skIn * skIn * skIn * skIn);
    var polyNum = [p0, p1, p2, p3];
    var q0 = m2, q2 = m4 - (1 + skIn * skIn) * m2 * m2;
    var b0 = q0 * q0 * q0, b2 = 3 * q0 * q0 * q2, b4 = 3 * q0 * q2 * q2, b6 = q2 * q2 * q2;
    var bPoly = [b0, b2, b4, b6];
    var d0 = p1 * b0, d1 = -p0 * b2 + 2 * p2 * b0, d2 = 3 * p3 * b0,
        d3 = -2 * p0 * b4 + p2 * b2, d4 = -p1 * b4 + 2 * p3 * b2, d5 = -3 * p0 * b6,
        d6 = -2 * p1 * b6 + p3 * b4, d7 = -p2 * b6;
    var droots = realRoots([d0, d1, d2, d3, d4, d5, d6, d7]);
    var lneg = -1e6, lpos = 1e6;
    for (i = 0; i < droots.length; i++) {
      var rp = droots[i];
      if (rp < 0 && rp > lneg) lneg = rp; else if (rp > 0 && rp < lpos) lpos = rp;
    }
    var skmin = L.polyEval(polyNum, lneg) / Math.sqrt(L.polyEval(bPoly, lneg * lneg));
    var skmax = L.polyEval(polyNum, lpos) / Math.sqrt(L.polyEval(bPoly, lpos * lpos));

    var lambda = 0;
    if (skOut <= skmin) lambda = lneg;
    else if (skOut >= skmax) lambda = lpos;
    else {
      var so2 = skOut * skOut;
      var a0 = p0 * p0 - so2 * b0, a1 = 2 * p1 * p0, a2 = p1 * p1 + 2 * p2 * p0 - so2 * b2,
          a3 = 2 * (p3 * p0 + p1 * p2), a4 = p2 * p2 + 2 * p3 * p1 - so2 * b4,
          a5 = 2 * p3 * p2, a6 = p3 * p3 - so2 * b6;
      var rr = realRoots([a0, a1, a2, a3, a4, a5, a6]);
      if (rr.length === 1) lambda = rr[0];
      else if (rr.length > 1) {
        var sign0 = (Math.abs(skOut) < 1e-6) ? 0 : (skOut > 0 ? 1 : -1);
        var finals = [];
        for (i = 0; i < rr.length; i++) {
          var num = L.polyEval(polyNum, rr[i]);
          var sign = (Math.abs(num) < 1e-6) ? 0 : (num > 0 ? 1 : -1);
          if (sign === sign0 || sign * sign0 === 0) finals.push(rr[i]);
        }
        if (finals.length > 0) {
          lambda = finals[0]; var mod = Math.abs(lambda);
          for (i = 1; i < finals.length; i++) if (Math.abs(finals[i]) < mod) { lambda = finals[i]; mod = Math.abs(finals[i]); }
        }
      }
    }
    var stdsk = std * skIn;
    for (i = 0; i < N; i++) { var xi = data[off + i]; data[off + i] += lambda * (xi * (xi - stdsk) - m2); }
    adjustMeanVariance(data, 0, m2, N, off);
  }

  // Adjust kurtosis (Algorithm 7). data assumed zero mean over [off, off+N).
  function adjustKurtosis(data, kuOut, N, off) {
    off = off || 0;
    var m2 = 0, m3 = 0, m4 = 0, m5 = 0, m6 = 0, m7 = 0, m8 = 0, m9 = 0, m10 = 0, m12 = 0;
    for (var i = 0; i < N; i++) {
      var x = data[off + i], t = x * x; m2 += t; t *= x; m3 += t; t *= x; m4 += t;
      t *= x; m5 += t; t *= x; m6 += t; t *= x; m7 += t; t *= x; m8 += t;
      t *= x; m9 += t; t *= x; m10 += t; t *= x * x; m12 += t;
    }
    var inv = 1 / N;
    m2 *= inv; m3 *= inv; m4 *= inv; m5 *= inv; m6 *= inv; m7 *= inv; m8 *= inv; m9 *= inv; m10 *= inv; m12 *= inv;
    var kuIn = m4 / (m2 * m2);
    var snr = 20 * Math.log(Math.abs(kuOut / (kuOut - kuIn))) / Math.LN10;
    if (snr > 60) return;
    var alpha = m4 / m2;
    var p0 = m4;
    var p1 = 4 * (m6 - alpha * alpha * m2 - m3 * m3);
    var p2 = 6 * (m8 - 2 * alpha * m6 - 2 * m3 * m5 + alpha * alpha * m4 + (m2 + 2 * alpha) * m3 * m3);
    var p3 = 4 * (m10 - 3 * alpha * m8 - 3 * m3 * m7 + 3 * alpha * alpha * m6 + 6 * alpha * m3 * m5 +
                  3 * m3 * m3 * m4 - alpha * alpha * alpha * m4 - 3 * alpha * alpha * m3 * m3 - 3 * m4 * m3 * m3);
    var p4 = m12 - 4 * alpha * m10 - 4 * m3 * m9 + 6 * alpha * alpha * m8 + 12 * alpha * m3 * m7 +
             6 * m3 * m3 * m6 - 4 * alpha * alpha * alpha * m6 - 12 * alpha * alpha * m3 * m5 +
             alpha * alpha * alpha * alpha * m4 - 12 * alpha * m3 * m3 * m4 + 4 * alpha * alpha * alpha * m3 * m3 +
             6 * alpha * alpha * m3 * m3 * m2 - 3 * m3 * m3 * m3 * m3;
    var polyNum = [p0, p1, p2, p3, p4];
    var q0 = m2, q2 = p1 * 0.25;
    var polyDenom = [q0, 0, q2];
    var d0 = p1 * q0, d1 = -4 * q2 * p0 + 2 * p2 * q0, d2 = -3 * q2 * p1 + 3 * p3 * q0,
        d3 = -2 * p2 * q2 + 4 * p4 * q0, d4 = -p3 * q2;
    var droots = realRoots([d0, d1, d2, d3, d4]);
    var lneg = -1e6, lpos = 1e6;
    for (i = 0; i < droots.length; i++) {
      var rp = droots[i];
      if (rp < 0 && rp > lneg) lneg = rp; else if (rp > 0 && rp < lpos) lpos = rp;
    }
    var tneg = L.polyEval(polyDenom, lneg), kumin = L.polyEval(polyNum, lneg) / (tneg * tneg);
    var tpos = L.polyEval(polyDenom, lpos), kumax = L.polyEval(polyNum, lpos) / (tpos * tpos);
    var lambda = 0;
    if (kuOut <= kumin) lambda = lneg;
    else if (kuOut >= kumax) lambda = lpos;
    else {
      var a4 = p4 - kuOut * q2 * q2, a3 = p3, a2 = p2 - 2 * kuOut * q0 * q2, a1 = p1, a0 = p0 - kuOut * q0 * q0;
      var rr = realRoots([a0, a1, a2, a3, a4]);
      if (rr.length > 0) {
        lambda = rr[0]; var mod = Math.abs(lambda);
        for (i = 1; i < rr.length; i++) if (Math.abs(rr[i]) < mod) { lambda = rr[i]; mod = Math.abs(rr[i]); }
      }
    }
    for (i = 0; i < N; i++) { var xi = data[off + i]; data[off + i] += lambda * (xi * (xi * xi - alpha) - m3); }
    adjustMeanVariance(data, 0, m2, N, off);
  }

  // --- auto-correlation (Algorithm 8), single image channel oriented ---
  // data: Float64Array (length nx*ny*nz). var0/vari: length-nz arrays.
  function adjustAutoCor(data, Ac, var0, vari, nx, ny, nz, Na, scale) {
    var hNa = ((Na - 1) / 2) | 0, Na2 = 2 * Na - 1, hNa2 = ((Na2 - 1) / 2) | 0;
    var N = nx * ny, t = ((Na * Na + 1) / 2) | 0;
    var tol = (nz === 3) ? 1e-3 : 1e-4;
    var fftData = FFT.allocComplex(N * nz);
    var modR = new Float64Array(N * nz);
    FFT.fftReal(fftData, data, nx, ny, nz);
    var i, j, k, p, l;

    for (l = 0; l < nz; l++) {
      var off = l * N;
      if (vari[l] / var0[l] > tol) {
        // |F|^2 -> autocorrelation image
        var fAc = FFT.allocComplex(N);
        for (i = 0; i < N; i++) {
          var re = fftData.re[off + i], im = fftData.im[off + i];
          fAc.re[i] = re * re + im * im; fAc.im[i] = 0;
        }
        FFT.ifftReal(modR, fAc, nx, ny, 1);
        // central (Na2 x Na2), normalized by 1/N
        var AcIn = new Float64Array(Na2 * Na2);
        var ifactor = 1 / N;
        for (i = 0; i < Na2; i++) for (j = 0; j < Na2; j++) {
          var ind;
          if (i < hNa2 && j < hNa2) ind = nx - hNa2 + i + (ny - hNa2 + j) * nx;
          else if (i < hNa2 && j > hNa2 - 1) ind = nx - hNa2 + i + (j - hNa2) * nx;
          else if (i > hNa2 - 1 && j < hNa2) ind = i - hNa2 + (ny - hNa2 + j) * nx;
          else ind = i - hNa2 + (j - hNa2) * nx;
          AcIn[i + j * Na2] = modR[ind] * ifactor;
        }
        // build A (t x t) and B (t)
        var acIn = L.zeros(Na2), acOut = L.zeros(Na);
        for (i = 0; i < Na2; i++) for (j = 0; j < Na2; j++) acIn[j][i] = AcIn[i + j * Na2];
        for (i = 0; i < Na; i++) for (j = 0; j < Na; j++) acOut[j][i] = Ac[i + j * Na + l * Na * Na];
        var A = L.zeros(t), B = new Array(t);
        for (k = hNa; k < Na; k++) {
          var endLoop = (k < Na - 1) ? hNa + Na : Na;
          for (p = hNa; p < endLoop; p++) {
            var rowidx = (k - hNa) * Na + (p - hNa);
            // rM[a][b] = M[a][b] + M[Na-1-a][Na-1-b], M = acIn.block(k-hNa, p-hNa)
            var rM = L.zeros(Na);
            for (var a = 0; a < Na; a++) for (var b = 0; b < Na; b++)
              rM[a][b] = acIn[k - hNa + a][p - hNa + b] + acIn[k - hNa + (Na - 1 - a)][p - hNa + (Na - 1 - b)];
            rM[hNa][hNa] /= 2;
            // column-major flatten, first t entries
            for (var idx = 0; idx < t; idx++) A[rowidx][idx] = rM[idx % Na][(idx / Na) | 0];
            B[rowidx] = acOut[k - hNa][p - hNa];
          }
        }
        var sol = L.solve(A, B, t);
        // fullsol length 2t-1, reshaped Na x Na (column-major)
        var fullsol = new Float64Array(2 * t - 1);
        for (i = 0; i < t; i++) { fullsol[i] = sol[i]; if (i < t - 1) fullsol[t + i] = sol[t - i - 2]; }
        var fullM = L.zeros(Na);
        for (i = 0; i < Na; i++) for (j = 0; j < Na; j++) fullM[i][j] = fullsol[i + j * Na];
        // place into hsquared0 (ny x nx) then fftshift -> spatial array
        var spatial = new Float64Array(N);
        var ny2 = (ny / 2) | 0, nx2 = (nx / 2) | 0;
        var H = L.zeros(ny, nx);
        for (i = 0; i < Na; i++) for (j = 0; j < Na; j++) H[ny2 - hNa + i][nx2 - hNa + j] = fullM[i][j];
        for (var y = 0; y < ny; y++) for (var xx = 0; xx < nx; xx++)
          spatial[xx + y * nx] = H[(y + ny2) % ny][(xx + nx2) % nx];
        // fft of spatial, multiply fftData by sqrt(|Re|)
        var fH = FFT.allocComplex(N);
        FFT.fftReal(fH, spatial, nx, ny, 1);
        for (i = 0; i < N; i++) {
          var factor = Math.sqrt(Math.abs(fH.re[i]));
          fftData.re[off + i] *= factor; fftData.im[off + i] *= factor;
        }
        // inverse -> data channel
        var outR = new Float64Array(N);
        var sub = { re: fftData.re.subarray(off, off + N), im: fftData.im.subarray(off, off + N) };
        FFT.ifftReal(outR, sub, nx, ny, 1);
        for (i = 0; i < N; i++) data[off + i] = outR[i];
      } else {
        adjustMeanVariance(data, 0, vari[l] / Math.pow(16, scale), N, off);
      }
    }
  }

  // --- pairwise cross-correlation (Algorithm 9) ---
  // data: array of N_data Float64Array (each length N*nz). cross_cor target.
  function adjustCrossCor(data, crossCor, N_data, N, nz) {
    var D = N_data * nz;
    // V rows
    var V = L.zeros(D, N);
    for (var l = 0; l < nz; l++) for (var i = 0; i < N_data; i++) {
      var row = V[i + l * N_data], src = data[i], soff = l * N;
      for (var j = 0; j < N; j++) row[j] = src[soff + j];
    }
    var tildeC = L.zeros(D);
    for (i = 0; i < D; i++) for (j = 0; j < D; j++) tildeC[i][j] = crossCor[j + i * D];
    // C = V V^T / N
    var C = L.zeros(D);
    for (i = 0; i < D; i++) for (j = i; j < D; j++) {
      var s = 0; for (var n = 0; n < N; n++) s += V[i][n] * V[j][n]; s /= N; C[i][j] = s; C[j][i] = s;
    }
    var ei = L.jacobiEigen(C, D), eo = L.jacobiEigen(tildeC, D);
    var isD = new Array(D), sD = new Array(D); var test1 = false, test2 = false;
    for (i = 0; i < D; i++) {
      isD[i] = 0; sD[i] = 0;
      if (ei.values[i] > 1e-12) { isD[i] = 1 / Math.sqrt(ei.values[i]); test1 = true; }
      if (eo.values[i] > 0) { sD[i] = Math.sqrt(eo.values[i]); test2 = true; }
    }
    if (!(test1 && test2)) return;
    // Lambda = Pout sDout Pout^T Pin isDin Pin^T
    var Lambda = composeLambda(eo.vectors, sD, ei.vectors, isD, D);
    // V = Lambda V ; write back
    applyLambda(data, Lambda, N_data, N, nz, D);
  }

  // Lambda = Pout * diag(sD) * Pout^T * Pin * diag(isD) * Pin^T   (all real)
  function composeLambda(Pout, sD, Pin, isD, D) {
    var i, j, k;
    // M1 = Pout diag(sD) Pout^T
    var M1 = L.zeros(D);
    for (i = 0; i < D; i++) for (j = 0; j < D; j++) {
      var s = 0; for (k = 0; k < D; k++) s += Pout[i][k] * sD[k] * Pout[j][k]; M1[i][j] = s;
    }
    var M2 = L.zeros(D);
    for (i = 0; i < D; i++) for (j = 0; j < D; j++) {
      var s2 = 0; for (k = 0; k < D; k++) s2 += Pin[i][k] * isD[k] * Pin[j][k]; M2[i][j] = s2;
    }
    return L.matMul(M1, M2, D, D, D);
  }
  function applyLambda(data, Lambda, N_data, N, nz, D) {
    var newrows = L.zeros(D, N);
    for (var l = 0; l < nz; l++) for (var i = 0; i < N_data; i++) {
      var ri = i + l * N_data, out = newrows[ri];
      for (var k = 0; k < N_data; k++) {
        var lk = Lambda[ri][k + l * N_data]; if (lk === 0) continue;
        var src = data[k], soff = l * N;
        for (var j = 0; j < N; j++) out[j] += lk * src[soff + j];
      }
    }
    for (l = 0; l < nz; l++) for (i = 0; i < N_data; i++) {
      var dst = data[i], doff = l * N, r = newrows[i + l * N_data];
      for (var j2 = 0; j2 < N; j2++) dst[doff + j2] = r[j2];
    }
  }

  root.PS = root.PS || {};
  root.PS.Adjust = {
    adjustRange: adjustRange, adjustMeanVariance: adjustMeanVariance,
    adjustSkewness: adjustSkewness, adjustKurtosis: adjustKurtosis,
    adjustAutoCor: adjustAutoCor, adjustCrossCor: adjustCrossCor
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PS.Adjust;
})(typeof globalThis !== 'undefined' ? globalThis : this);
