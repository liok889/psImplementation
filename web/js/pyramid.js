// Multi-scale steerable pyramid decomposition, ported from
// reference/src/pyramid.cpp (Algorithm 2 / Section 2.4). Filtering is done in
// the Fourier domain. option=1 => analysis (all low-bands kept), option=0 =>
// synthesis (only the last low-band kept).
//
// Returns a pyramid object:
//   highband : Float64Array(nx*ny*nz)
//   lowband  : array length (1+N_pyr); analysis => all filled, else only [N_pyr]
//   steered  : array length N_pyr*N_steer of complex {re,im} (size sx*sy*nz)
(function (root) {
  'use strict';
  var FFT = root.PS.FFT;

  function createPyramid(image, filters, params, option) {
    var N_steer = params.N_steer, N_pyr = params.N_pyr;
    var nx = image.nx, ny = image.ny, nz = image.nz;
    var size = filters.size;

    var highband = new Float64Array(nx * ny * nz);
    var lowband = new Array(N_pyr + 1);
    var steered = new Array(N_pyr * N_steer);

    var fftTmp = FFT.allocComplex(nx * ny * nz);
    var fftTmp2 = FFT.allocComplex(nx * ny * nz);

    // FFT of the input
    FFT.fftReal(fftTmp, image.image, nx, ny, nz);

    // set the mean (DC) to 0 in each channel
    for (var l = 0; l < nz; l++) { fftTmp.re[l * nx * ny] = 0; fftTmp.im[l * nx * ny] = 0; }

    // high-frequency residual (Line 1)
    FFT.pointwiseCFMul(fftTmp2, fftTmp, filters.highpass0, nx * ny, nz);
    FFT.ifftReal(highband, fftTmp2, nx, ny, nz);

    // low-frequency band (Line 2)
    FFT.pointwiseCFMul(fftTmp, fftTmp, filters.lowpass0[0], nx * ny, nz);
    if (option) {
      lowband[0] = new Float64Array(nx * ny * nz);
      FFT.ifftReal(lowband[0], fftTmp, nx, ny, nz);
    }

    var sx = nx, sy = ny;
    for (var i = 0; i < N_pyr; i++) {
      for (var j = 0; j < N_steer; j++) {
        FFT.pointwiseCFMul(fftTmp2, fftTmp, filters.steered[j + i * N_steer], sx * sy, nz);
        var band = FFT.allocComplex(sx * sy * nz);
        FFT.ifft(band, fftTmp2, sx, sy, nz);
        steered[j + i * N_steer] = band;
      }
      sx = (sx / 2) | 0; sy = (sy / 2) | 0;
      // down-sample (Line 6): old size (2sx)x(2sy) in fftTmp -> new sx x sy in fftTmp2
      FFT.downsampling(fftTmp2, fftTmp, sx, sy, nz);
      // low-pass (Line 7)
      FFT.pointwiseCFMul(fftTmp, fftTmp2, filters.lowpass0[i + 1], sx * sy, nz);
      if (option || i === N_pyr - 1) {
        lowband[i + 1] = new Float64Array(sx * sy * nz);
        FFT.ifftReal(lowband[i + 1], fftTmp, sx, sy, nz);
      }
    }

    return { highband: highband, lowband: lowband, steered: steered,
             nx: nx, ny: ny, nz: nz, size: size };
  }

  root.PS = root.PS || {};
  root.PS.Pyramid = { createPyramid: createPyramid };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PS.Pyramid;
})(typeof globalThis !== 'undefined' ? globalThis : this);
