// Steerable-pyramid filters, ported from reference/src/filters.cpp (Section 2.1).
// All filters are real-valued frequency-domain masks stored as Float64Array of
// length sx*sy, row-major (index j + k*nx, with j=column, k=row -- matching the
// C++ loops which write out[j + k*nx]).
(function (root) {
  'use strict';
  var PI = Math.PI;

  // Low-pass filter (Eq. 7/11). factor=1 <-> L, factor=2 <-> L0.
  function computeLowpass(out, nx, ny, factor) {
    var factorx = 4.0 / nx, factory = 4.0 / ny;
    var ifactor = 1.0 / (factor * factor);
    var factorcos = 0.25 * PI / Math.log(2);
    for (var j = 0; j < nx; j++) {
      var x = (2 * j < nx) ? j * factorx : (j - nx) * factorx;
      var x2 = x * x;
      for (var k = 0; k < ny; k++) {
        var y = (2 * k < ny) ? k * factory : (k - ny) * factory;
        var r = (x2 + y * y) * ifactor;
        out[j + k * nx] = (r <= 0.25 ? 1 : 0) +
          ((r > 0.25 && r < 1) ? Math.cos(factorcos * Math.log(4 * r)) : 0);
      }
    }
    out[0] = 1.0;
  }

  // High-pass filter (Eq. 8/12). factor=1 <-> H, factor=2 <-> H0.
  function computeHighpass(out, nx, ny, factor) {
    var factorx = 4.0 / nx, factory = 4.0 / ny;
    var ifactor = 1.0 / (factor * factor);
    var factorcos = 0.25 * PI / Math.log(2);
    for (var j = 0; j < nx; j++) {
      var x = (2 * j < nx) ? j * factorx : (j - nx) * factorx;
      var x2 = x * x;
      for (var k = 0; k < ny; k++) {
        var y = (2 * k < ny) ? k * factory : (k - ny) * factory;
        var r = (x2 + y * y) * ifactor;
        out[j + k * nx] = (r >= 1 ? 1 : 0) +
          ((r > 0.25 && r < 1) ? Math.cos(factorcos * Math.log(r)) : 0);
      }
    }
    out[0] = 0.0;
  }

  // Steered mask (Eq. 19), used for synthesis only.
  function computeMask(out, nx, ny, steer, N_steer) {
    var factorx = 2 * PI / nx, factory = 2 * PI / ny;
    var nxh = (nx / 2) | 0, nyh = (ny / 2) | 0;
    for (var j = 0; j < nx; j++) {
      var x = (j < nxh) ? j * factorx : (j - nx) * factorx;
      for (var k = 0; k < ny; k++) {
        if (j === nxh || k === nyh) { out[j + k * nx] = 1; continue; }
        var y = (k < nyh) ? k * factory : (k - ny) * factory;
        var theta = Math.atan2(y, x);
        var theta0 = 2 * Math.abs(mod(theta + 3 * PI - PI * steer / N_steer, 2 * PI) - PI);
        out[j + k * nx] = (theta0 < PI ? 2 : 0) + (theta0 === PI ? 1 : 0);
      }
    }
    out[0] = 1.0;
  }

  // C-style fmod (truncated toward zero) for negative-safe parity with C++.
  function mod(a, b) { return a - b * Math.trunc(a / b); }

  // Steered filters (Eq. 9), without the high-pass multiplication.
  function computeSteered(out, nx, ny, steer, N_steer, alpha) {
    var factorx = 2 * PI / nx, factory = 2 * PI / ny;
    for (var j = 0; j < nx; j++) {
      var x = (2 * j < nx) ? j * factorx : (j - nx) * factorx;
      for (var k = 0; k < ny; k++) {
        var y = (2 * k < ny) ? k * factory : (k - ny) * factory;
        var theta = Math.atan2(y, x);
        var theta2 = 2 * Math.abs(mod(theta + 3 * PI - PI * steer / N_steer, 2 * PI) - PI);
        var factor = Math.cos(theta - PI * steer / N_steer);
        var cosinus = 1.0;
        for (var p = 1; p < N_steer; p++) cosinus *= factor;
        out[j + k * nx] = 2 * alpha * cosinus * (theta2 < PI ? 1 : 0);
      }
    }
    out[0] = 0.0;
  }

  // Sizes of the filters at each scale.
  function sizeFilters(nx, ny, N_pyr) {
    var size = new Array(2 * (1 + N_pyr));
    size[0] = nx; size[1] = ny;
    for (var i = 1; i < N_pyr + 1; i++) {
      size[2 * i] = (size[2 * (i - 1)] * 0.5) | 0;
      size[2 * i + 1] = (size[2 * (i - 1) + 1] * 0.5) | 0;
    }
    return size;
  }

  // Reversibility constant alpha (Eq. 10).
  function computeReversibility(N_steer) {
    var l1 = 0, l2 = 0, k;
    for (k = 2; k < N_steer; k++) l1 += Math.log(k);
    for (k = 2; k < 2 * N_steer - 1; k++) l2 += Math.log(k);
    var logAlpha = (N_steer - 1) * Math.log(2) + l1 - 0.5 * (Math.log(N_steer) + l2);
    return Math.exp(logAlpha);
  }

  // compute_filters (Section 2.2/2.4). option=1 analysis, option=0 synthesis.
  // Returns { size, highpass0, lowpass0[1+N_pyr], steered[N_pyr*N_steer], mask? }.
  function computeFilters(nx, ny, N_pyr, N_steer, option) {
    var size = sizeFilters(nx, ny, N_pyr);
    var lowpass0 = new Array(1 + N_pyr);
    var highpass0 = new Float64Array(nx * ny);
    var steered = new Array(N_pyr * N_steer);
    var mask = option ? null : new Array(N_pyr * N_steer);

    var sx = 0, sy = 0;
    var highpass = new Float64Array(nx * ny);

    computeHighpass(highpass0, nx, ny, 2);
    var alpha = computeReversibility(N_steer);

    for (var i = 0; i < N_pyr; i++) {
      sx = size[2 * i]; sy = size[2 * i + 1];
      lowpass0[i] = new Float64Array(sx * sy);
      computeLowpass(lowpass0[i], sx, sy, 2);
      computeHighpass(highpass, sx, sy, 1);
      for (var j = 0; j < N_steer; j++) {
        var ind = i * N_steer + j;
        var s = new Float64Array(sx * sy);
        computeSteered(s, sx, sy, j, N_steer, alpha);
        for (var l = 0; l < sx * sy; l++) s[l] *= highpass[l];
        steered[ind] = s;
        if (!option) {
          var mk = new Float64Array(sx * sy);
          computeMask(mk, sx, sy, j, N_steer);
          mask[ind] = mk;
        }
      }
    }
    // last low-pass at quarter size
    var lsx = (sx * 0.5) | 0, lsy = (sy * 0.5) | 0;
    lowpass0[N_pyr] = new Float64Array(lsx * lsy);
    computeLowpass(lowpass0[N_pyr], lsx, lsy, 2);

    return { size: size, highpass0: highpass0, lowpass0: lowpass0,
             steered: steered, mask: mask };
  }

  root.PS = root.PS || {};
  root.PS.Filters = { computeFilters: computeFilters,
                      _internal: { computeLowpass: computeLowpass,
                                   computeHighpass: computeHighpass,
                                   computeSteered: computeSteered,
                                   computeMask: computeMask,
                                   computeReversibility: computeReversibility,
                                   sizeFilters: sizeFilters } };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PS.Filters;
})(typeof globalThis !== 'undefined' ? globalThis : this);
