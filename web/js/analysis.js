// Image analysis: pixel statistics + steerable-pyramid summary statistics.
// Ported from reference/src/analysis.cpp (Line 1-2 of Algorithm 5) and the
// compute_* helpers. This module implements the grayscale path (nz=1) faithfully;
// the color (nz=3) branches are flagged where the reference diverges.
(function (root) {
  'use strict';
  var FFT = root.PS.FFT, S = root.PS.Stats;
  var Filters = root.PS.Filters, Pyramid = root.PS.Pyramid;

  var N_PIXELSTATS = 6;
  var N_SMALLEST = 5;

  // Allocate the summary-statistics container (grayscale layout).
  function allocateStats(params, nz) {
    var N_pyr = params.N_pyr, N_steer = params.N_steer, Na = params.Na;
    var s = {};
    s.pixelStats = new Float64Array(N_PIXELSTATS * nz);
    s.skewLow = new Float64Array((1 + N_pyr) * nz);
    s.kurtLow = new Float64Array((1 + N_pyr) * nz);
    s.varHigh = new Float64Array(nz);
    s.magMeans = new Float64Array(N_pyr * N_steer * nz);
    s.autoCorLow = []; for (var i = 0; i < 1 + N_pyr; i++) s.autoCorLow.push(new Float64Array(Na * Na * nz));
    s.autoCorMag = []; for (i = 0; i < N_pyr * N_steer; i++) s.autoCorMag.push(new Float64Array(Na * Na * nz));
    s.cousinMagCor = []; for (i = 0; i < N_pyr; i++) s.cousinMagCor.push(new Float64Array(N_steer * N_steer * nz * nz));
    s.parentMagCor = []; for (i = 0; i < N_pyr - 1; i++) s.parentMagCor.push(new Float64Array(N_steer * N_steer * nz * nz));
    s.parentRealCor = []; for (i = 0; i < N_pyr; i++) s.parentRealCor.push(new Float64Array(2 * N_steer * N_steer * nz * nz));
    return s;
  }

  // compute_stats: fills `stats` from the pyramid (Line 2 of Algorithm 5).
  function computeStats(stats, pyramid, sample, filters, params, nz) {
    var N_steer = params.N_steer, N_pyr = params.N_pyr, Na = params.Na;
    var hNa = ((Na - 1) / 2) | 0;
    var size = filters.size;
    var nx = size[0], ny = size[1];
    var maxN = nx * ny;

    var magSteered = [], realSteered = [], parents = [], rparents = [];
    for (var j = 0; j < N_steer; j++) {
      magSteered.push(new Float64Array(maxN * nz));
      realSteered.push(new Float64Array(maxN * nz));
      parents.push(new Float64Array(maxN * nz));
    }
    for (j = 0; j < 2 * N_steer; j++) rparents.push(new Float64Array(maxN * nz));

    var fftTmp = FFT.allocComplex(maxN * nz);
    var fftTmp2 = FFT.allocComplex(maxN * nz);
    var zoomC = FFT.allocComplex(maxN * nz);
    var tmp = new Float64Array(maxN * nz);

    var l, i, k, ind, sx, sy, meani, vari;

    // variance of the high-pass (summary stat i.b)
    for (l = 0; l < nz; l++)
      stats.varHigh[l] = S.computeMoment(pyramid.highband, 0.0, 2, nx * ny, l * nx * ny);

    // statistics of the low-frequency residual at each scale (i.a, ii)
    for (i = 0; i < 1 + N_pyr; i++) {
      sx = size[2 * i]; sy = size[2 * i + 1];
      var Ni = sx * sy;
      // apply second low-pass
      FFT.fftReal(fftTmp, pyramid.lowband[i], sx, sy, nz);
      FFT.pointwiseCFMul(fftTmp, fftTmp, filters.lowpass0[i], Ni, nz);
      FFT.ifftReal(tmp, fftTmp, sx, sy, nz);

      S.computeAutoCor(stats.autoCorLow[i], tmp, sx, sy, nz, Na);
      for (l = 0; l < nz; l++) {
        vari = stats.autoCorLow[i][hNa + hNa * Na + l * Na * Na];
        stats.skewLow[i + (1 + N_pyr) * l] = S.computeSkewness(tmp, 0.0, vari, Ni, l * Ni);
        stats.kurtLow[i + (1 + N_pyr) * l] = S.computeKurtosis(tmp, 0.0, vari, Ni, l * Ni);
      }
    }

    // statistics of the steered bands
    for (i = 0; i < N_pyr; i++) {
      sx = size[2 * i]; sy = size[2 * i + 1];
      var Ns = sx * sy;

      for (j = 0; j < N_steer; j++) {
        ind = j + i * N_steer;
        var band = pyramid.steered[ind];
        for (k = 0; k < Ns * nz; k++) {
          magSteered[j][k] = Math.hypot(band.re[k], band.im[k]);
          realSteered[j][k] = band.re[k];
        }
        for (l = 0; l < nz; l++) {
          meani = stats.magMeans[ind + (N_pyr * N_steer) * l] = S.mean(magSteered[j], Ns, l * Ns);
          for (k = 0; k < Ns; k++) magSteered[j][k + l * Ns] -= meani;
        }
      }

      for (j = 0; j < N_steer; j++) {
        ind = j + i * N_steer;
        S.computeAutoCor(stats.autoCorMag[ind], magSteered[j], sx, sy, nz, Na);
      }

      // parents (coarser scale) for cross-scale correlations
      if (i === N_pyr - 1) {
        if (nz === 3) {
          // color-only: zoom last low-band into rparents (Appendix B.2)
          var sx2 = (sx / 2) | 0, sy2 = (sy / 2) | 0;
          FFT.fftReal(fftTmp, pyramid.lowband[i + 1], sx2, sy2, nz);
          FFT.upsampling(fftTmp2, fftTmp, sx2, sy2, nz);
          FFT.ifftReal(tmp, fftTmp2, sx, sy, nz);
          rparents[0].set(tmp.subarray(0, nz * Ns));
          S.shift(rparents[1], tmp, 0, 2, sx, sy, nz);
          S.shift(rparents[2], tmp, 0, -2, sx, sy, nz);
          S.shift(rparents[3], tmp, 2, 0, sx, sy, nz);
          S.shift(rparents[4], tmp, -2, 0, sx, sy, nz);
        }
      } else {
        var sxh = (sx / 2) | 0, syh = (sy / 2) | 0;
        for (j = 0; j < N_steer; j++) {
          ind = j + (i + 1) * N_steer;
          var pband = pyramid.steered[ind];
          FFT.fft(fftTmp, pband, sxh, syh, nz);
          FFT.upsampling(fftTmp2, fftTmp, sxh, syh, nz);
          FFT.ifft(zoomC, fftTmp2, sx, sy, nz);
          for (k = 0; k < Ns * nz; k++) {
            var pm = Math.hypot(zoomC.re[k], zoomC.im[k]);
            parents[j][k] = pm;
            var theta = 2 * Math.atan2(zoomC.im[k], zoomC.re[k]);
            rparents[j][k] = pm * Math.cos(theta);
            rparents[j + N_steer][k] = pm * Math.sin(theta);
          }
          for (l = 0; l < nz; l++) {
            meani = S.mean(parents[j], Ns, l * Ns);
            for (k = 0; k < Ns; k++) parents[j][k + l * Ns] -= meani;
          }
        }
      }

      // pairwise cross-correlation of magnitudes (iv)
      S.computeCrossCor(stats.cousinMagCor[i], magSteered, N_steer, Ns, nz);

      // magnitude cross-scale correlation (v)
      if (i < N_pyr - 1)
        S.computeCrossScaleCor(stats.parentMagCor[i], magSteered, parents, N_steer, N_steer, Ns, nz);

      // (color-only) cousin real correlations (x, xi) -- omitted for grayscale

      // real cross-scale correlation (vi) [grayscale: only i<N_pyr-1, N_data=2*N_steer]
      if (i < N_pyr - 1 || nz === 3) {
        var N_data = (i === N_pyr - 1) ? N_SMALLEST : 2 * N_steer;
        S.computeCrossScaleCor(stats.parentRealCor[i], realSteered, rparents, N_steer, N_data, Ns, nz);
      }
    }
  }

  // analysis(): full analysis of a sample image (grayscale). `mt` is a seeded
  // PS.MT instance; the tiny stabilizing noise is added exactly as in the C++.
  function analysis(sample, params, mt) {
    var nz = sample.nz, nx = sample.nx, ny = sample.ny, N = nx * ny;
    var stats = allocateStats(params, nz);
    // work on a copy so the caller's pixels are not mutated by the noise step
    var img = new Float64Array(sample.image);
    var work = { image: img, nx: nx, ny: ny, nz: nz };

    // pixel statistics (i.c), computed before noise/PCA
    for (var l = 0; l < nz; l++) {
      var mm = S.minAndMax(img, N, l * N);
      stats.pixelStats[0 + N_PIXELSTATS * l] = mm[0];
      stats.pixelStats[1 + N_PIXELSTATS * l] = mm[1];
      var m0 = stats.pixelStats[2 + N_PIXELSTATS * l] = S.mean(img, N, l * N);
      var var0 = stats.pixelStats[3 + N_PIXELSTATS * l] = S.computeMoment(img, m0, 2, N, l * N);
      stats.pixelStats[4 + N_PIXELSTATS * l] = S.computeSkewness(img, m0, var0, N, l * N);
      stats.pixelStats[5 + N_PIXELSTATS * l] = S.computeKurtosis(img, m0, var0, N, l * N);
    }

    // add stabilizing noise (grayscale only), matching analysis.cpp
    if (nz === 1) {
      for (l = 0; l < nz; l++) {
        var factor = (stats.pixelStats[1 + N_PIXELSTATS * l] - stats.pixelStats[0 + N_PIXELSTATS * l]) / 100000;
        for (var ii = 0; ii < N; ii++) img[ii + l * N] += factor * mt.genrandRes53();
      }
    }
    // NOTE: color path would apply PCA here (Appendix B.1); omitted for grayscale.

    var filters = Filters.computeFilters(nx, ny, params.N_pyr, params.N_steer, 1);
    var pyramid = Pyramid.createPyramid(work, filters, params, 1);
    computeStats(stats, pyramid, work, filters, params, nz);

    return { stats: stats, filters: filters, pyramid: pyramid, image: img };
  }

  root.PS = root.PS || {};
  root.PS.Analysis = { analysis: analysis, allocateStats: allocateStats,
                       computeStats: computeStats,
                       N_PIXELSTATS: N_PIXELSTATS, N_SMALLEST: N_SMALLEST };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PS.Analysis;
})(typeof globalThis !== 'undefined' ? globalThis : this);
