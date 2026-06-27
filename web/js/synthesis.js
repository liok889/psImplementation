// Iterative texture synthesis, ported from reference/src/synthesis.cpp
// (Algorithm 4 + Lines 3-9 of Algorithm 5). Grayscale (nz=1) path.
(function (root) {
  'use strict';
  var FFT = root.PS.FFT, S = root.PS.Stats, A = root.PS.Adjust;
  var Filters = root.PS.Filters, Pyramid = root.PS.Pyramid;

  // adjust_constraints: impose the summary statistics on `texture` given its
  // pyramid (Algorithm 4). cmask = [marginal, autocorr, magcorr, realcorr].
  function adjustConstraints(texture, stats, pyramid, filters, params) {
    var N_steer = params.N_steer, N_pyr = params.N_pyr, Na = params.Na;
    var hNa = ((Na - 1) / 2) | 0, cmask = params.cmask;
    var nx = texture.nx, ny = texture.ny, nz = texture.nz;
    var size = filters.size;
    var img = texture.image;
    var i, j, k, l, ind;

    var fftTmp = FFT.allocComplex(nx * ny * nz);
    var fftTmp2 = FFT.allocComplex(nx * ny * nz);
    var fftTmp3 = FFT.allocComplex(nx * ny * nz);
    var tmpSteered = [], parents = [], rparents = [];
    for (j = 0; j < N_steer; j++) { tmpSteered.push(new Float64Array(nx * ny * nz)); parents.push(new Float64Array(nx * ny * nz)); }
    for (j = 0; j < 2 * N_steer; j++) rparents.push(new Float64Array(nx * ny * nz));

    var variance = [nz === 1 ? stats.pixelStats[3] : 0];
    if (nz === 3) { variance = []; for (l = 0; l < 3; l++) variance.push(stats.eigenValuesPCA[l]); }
    var tol = (nz === 3) ? 1e-3 : 1e-4;

    var sx = size[2 * N_pyr], sy = size[2 * N_pyr + 1];

    // grayscale: fft of the low-band into fftTmp3
    FFT.fftReal(fftTmp3, pyramid.lowband[N_pyr], sx, sy, nz);

    // apply second low-pass -> img (buffer), Line 2
    FFT.pointwiseCFMul(fftTmp2, fftTmp3, filters.lowpass0[N_pyr], sx * sy, nz);
    FFT.ifftReal(img, fftTmp2, sx, sy, nz);

    var variance2 = [stats.autoCorLow[N_pyr][hNa + hNa * Na] * Math.pow(16, N_pyr)];

    if (cmask[1]) A.adjustAutoCor(img, stats.autoCorLow[N_pyr], variance, variance2, sx, sy, nz, Na, N_pyr);
    if (cmask[0]) {
      for (l = 0; l < nz; l++) if (variance2[l] / variance[l] > tol) {
        A.adjustSkewness(img, stats.skewLow[N_pyr + (1 + N_pyr) * l], sx * sy, l * sx * sy);
        A.adjustKurtosis(img, stats.kurtLow[N_pyr + (1 + N_pyr) * l], sx * sy, l * sx * sy);
      }
    }

    FFT.fftReal(fftTmp, img, sx, sy, nz);

    for (i = 0; i < N_pyr; i++) {
      FFT.upsampling(fftTmp2, fftTmp, sx, sy, nz);
      sx *= 2; sy *= 2;
      var Ns = sx * sy;

      // parents (coarser-scale magnitude/real) for i>0
      if ((cmask[2] || cmask[3]) && i > 0) {
        var sxh = (sx / 2) | 0, syh = (sy / 2) | 0;
        for (j = 0; j < N_steer; j++) {
          ind = N_steer * (N_pyr - i) + j;
          FFT.fft(fftTmp, pyramid.steered[ind], sxh, syh, nz);
          FFT.upsampling(fftTmp3, fftTmp, sxh, syh, nz);
          FFT.ifft(fftTmp, fftTmp3, sx, sy, nz);
          for (k = 0; k < Ns * nz; k++) {
            var pm = Math.hypot(fftTmp.re[k], fftTmp.im[k]);
            parents[j][k] = pm;
            var theta = 2 * Math.atan2(fftTmp.im[k], fftTmp.re[k]);
            rparents[j][k] = pm * Math.cos(theta);
            rparents[j + N_steer][k] = pm * Math.sin(theta);
          }
          for (l = 0; l < nz; l++) {
            var mp = S.mean(parents[j], Ns, l * Ns);
            for (k = 0; k < Ns; k++) parents[j][k + l * Ns] -= mp;
          }
        }
      }

      if (cmask[2]) {
        for (j = 0; j < N_steer; j++) {
          ind = N_steer * (N_pyr - i - 1) + j;
          var band = pyramid.steered[ind];
          for (k = 0; k < Ns * nz; k++) tmpSteered[j][k] = Math.hypot(band.re[k], band.im[k]);
          for (l = 0; l < nz; l++) { var mm = S.mean(tmpSteered[j], Ns, l * Ns); for (k = 0; k < Ns; k++) tmpSteered[j][k + l * Ns] -= mm; }
        }
        if (i === 0) A.adjustCrossCor(tmpSteered, stats.cousinMagCor[N_pyr - 1 - i], N_steer, Ns, nz);
        else A.adjustCrossScaleCor(tmpSteered, parents, stats.cousinMagCor[N_pyr - 1 - i], stats.parentMagCor[N_pyr - 1 - i], N_steer, N_steer, Ns, nz);

        for (j = 0; j < N_steer; j++) {
          ind = N_steer * (N_pyr - i - 1) + j;
          if (cmask[1]) A.adjustAutoCor(tmpSteered[j], stats.autoCorMag[ind], variance, variance, sx, sy, nz, Na, N_pyr - 1 - i);
          for (l = 0; l < nz; l++) { var add = stats.magMeans[ind + (N_pyr * N_steer) * l]; for (k = 0; k < Ns; k++) tmpSteered[j][k + l * Ns] += add; }
          var mag0 = 0; for (l = 0; l < nz; l++) mag0 += stats.magMeans[ind + (N_pyr * N_steer) * l]; mag0 /= nz;
          var bandj = pyramid.steered[ind];
          for (k = 0; k < nz * Ns; k++) {
            var v = tmpSteered[j][k] < 0 ? 0 : tmpSteered[j][k];
            var mag = Math.hypot(bandj.re[k], bandj.im[k]);
            if (mag < 1e-4 * mag0) mag = 1;
            tmpSteered[j][k] = bandj.re[k] * (v / mag);
          }
        }
      } else {
        for (j = 0; j < N_steer; j++) { ind = N_steer * (N_pyr - i - 1) + j; var b2 = pyramid.steered[ind]; for (k = 0; k < nz * Ns; k++) tmpSteered[j][k] = b2.re[k]; }
      }

      if (cmask[3] && !(nz === 3 && cmask[1]) && i > 0) {
        if (nz === 1) {
          for (j = 0; j < N_steer; j++) {
            var vari = S.computeMoment(tmpSteered[j], 0, 2, Ns, 0);
            var cor = stats.parentRealCor[N_pyr - 1 - i].subarray(j * 2 * N_steer, j * 2 * N_steer + 2 * N_steer);
            A.adjustCrossScaleCor([tmpSteered[j]], rparents, [vari], cor, 1, 2 * N_steer, Ns, 1);
          }
        }
      }

      // re-create the low-band (Lines 18-22)
      for (j = 0; j < N_steer; j++) {
        ind = N_steer * (N_pyr - i - 1) + j;
        for (k = 0; k < Ns * nz; k++) { fftTmp3.re[k] = tmpSteered[j][k]; fftTmp3.im[k] = 0; }
        FFT.fft(fftTmp, fftTmp3, sx, sy, nz);
        FFT.pointwiseCFMul(fftTmp, fftTmp, filters.mask[ind], Ns, nz);
        if (i < N_pyr - 1) FFT.ifft(pyramid.steered[ind], fftTmp, sx, sy, nz);
        FFT.pointwiseCFMul(fftTmp, fftTmp, filters.steered[ind], Ns, nz);
        for (k = 0; k < Ns * nz; k++) { fftTmp2.re[k] += 0.5 * fftTmp.re[k]; fftTmp2.im[k] += 0.5 * fftTmp.im[k]; }
      }

      FFT.pointwiseCFMul(fftTmp, fftTmp2, filters.lowpass0[N_pyr - 1 - i], Ns, nz);
      FFT.ifftReal(img, fftTmp, sx, sy, nz);

      variance2 = [stats.autoCorLow[N_pyr - 1 - i][hNa + hNa * Na] * Math.pow(16, N_pyr - 1 - i)];
      if (cmask[1]) A.adjustAutoCor(img, stats.autoCorLow[N_pyr - 1 - i], variance, variance2, sx, sy, nz, Na, N_pyr - 1 - i);
      if (cmask[0]) {
        for (l = 0; l < nz; l++) if (variance2[l] / variance[l] > tol) {
          A.adjustSkewness(img, stats.skewLow[N_pyr - 1 - i + (1 + N_pyr) * l], Ns, l * Ns);
          A.adjustKurtosis(img, stats.kurtLow[N_pyr - 1 - i + (1 + N_pyr) * l], Ns, l * Ns);
        }
      }
      if (i < N_pyr - 1) FFT.fftReal(fftTmp, img, sx, sy, nz);
    }

    // high-pass variance cap (Line 26)
    if (cmask[1] || cmask[2] || cmask[3]) {
      for (l = 0; l < nz; l++) {
        var vh = S.computeMoment(pyramid.highband, 0, 2, nx * ny, l * nx * ny);
        if (vh > stats.varHigh[l]) { var f = Math.sqrt(stats.varHigh[l] / vh); for (k = 0; k < nx * ny; k++) pyramid.highband[k + l * nx * ny] *= f; }
      }
    }
    // apply high-pass a second time (Line 27)
    FFT.fftReal(fftTmp, pyramid.highband, nx, ny, nz);
    FFT.pointwiseCFMul(fftTmp, fftTmp, filters.highpass0, nx * ny, nz);
    FFT.ifftReal(pyramid.highband, fftTmp, nx, ny, nz);
    for (k = 0; k < nx * ny * nz; k++) img[k] += pyramid.highband[k];

    // pixel statistics (Lines 29-33)
    for (l = 0; l < nz; l++) {
      if (cmask[0]) {
        A.adjustMeanVariance(img, 0, stats.pixelStats[3 + l * 6], nx * ny, l * nx * ny);
        A.adjustSkewness(img, stats.pixelStats[4 + 6 * l], nx * ny, l * nx * ny);
        A.adjustKurtosis(img, stats.pixelStats[5 + 6 * l], nx * ny, l * nx * ny);
      }
      var meani = stats.pixelStats[2 + l * 6];
      for (k = 0; k < nx * ny; k++) img[k + l * nx * ny] += meani;
      if (cmask[0]) A.adjustRange(img, stats.pixelStats[0 + l * 6], stats.pixelStats[1 + l * 6], nx * ny, l * nx * ny);
    }
  }

  // synthesis(): produce a texture of the requested size from `stats`.
  // mt: seeded PS.MT for the initial noise. onIter(k, image): optional callback.
  function synthesis(texture, stats, params, mt, onIter) {
    var N_pyr = params.N_pyr, N_steer = params.N_steer, N_iteration = params.N_iteration;
    var nxout = texture.nx, nyout = texture.ny, nz = texture.nz;

    var filters = Filters.computeFilters(nxout, nyout, N_pyr, N_steer, 0); // synthesis filters (with mask)

    // initialize noise (Line 3), grayscale
    if (!params.noise) {
      if (nz === 1) {
        // Align with the C++ RNG: the reference's grayscale analysis consumes
        // N = nx*ny draws (stabilizing noise) from the same seeded MT before
        // synthesis, so skip them here to reproduce its white-noise init for the
        // same seed (assumes output size == input size).
        for (var sk = 0; sk < nxout * nyout; sk++) mt.genrandRes53();
        var factor = Math.sqrt(stats.pixelStats[3]);
        for (var p = 0; p < nxout * nyout; p++) {
          var u1 = mt.genrandRes53(), u2 = mt.genrandRes53();
          var noise = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
          texture.image[p] = stats.pixelStats[2] + factor * noise;
        }
      }
    }

    // convergence accelerator buffer (Line 4)
    var tmp = (nz === 1) ? new Float64Array(texture.image) : null;

    for (var kk = 0; kk < N_iteration; kk++) {
      var pyr = Pyramid.createPyramid(texture, filters, params, 0);
      adjustConstraints(texture, stats, pyr, filters, params);
      if (onIter) onIter(kk, texture.image);
      if (nz === 1 && kk < N_iteration - 1) {
        for (var ii = 0; ii < nxout * nyout; ii++) {
          var nv = texture.image[ii];
          texture.image[ii] += 0.8 * (texture.image[ii] - tmp[ii]);
          tmp[ii] = nv;
        }
      }
    }
    return texture;
  }

  root.PS = root.PS || {};
  root.PS.Synthesis = { synthesis: synthesis, adjustConstraints: adjustConstraints };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PS.Synthesis;
})(typeof globalThis !== 'undefined' ? globalThis : this);
