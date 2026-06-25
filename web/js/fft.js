// FFT utilities mirroring reference/src/toolbox.cpp (the Fourier helpers).
//
// Conventions match FFTW exactly, since the reference uses fftwf:
//   * 2D arrays are row-major with linear index  i + j*nx  (i: column/x in
//     [0,nx), j: row/y in [0,ny)).  fftwf_plan_dft_2d(ny, nx, ...) => same.
//   * forward transform uses e^{-2*pi*i*k*n/N}, NOT normalized.
//   * inverse transform uses e^{+2*pi*i*k*n/N}; the 1/N normalization is applied
//     explicitly by the *_real / ifft helpers (as in toolbox.cpp).
//
// Complex signals are stored as two planar Float64Array's {re, im} of length
// nx*ny*nz, indexed  i + j*nx + k*nx*ny  (k = channel), identical to the C++
// fftwf_complex layout.  Float64 is used throughout (the reference uses float);
// differences are ~1e-6 relative and absorbed by the validation tolerances.
(function (root) {
  'use strict';

  function isPow2(n) { return (n & (n - 1)) === 0; }

  // In-place iterative radix-2 Cooley-Tukey on length-n re/im (n a power of 2).
  // sign = -1 forward, +1 inverse. No normalization.
  function fftRadix2(re, im, n, sign) {
    // bit reversal
    for (var i = 1, j = 0; i < n; i++) {
      var bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        var tr = re[i]; re[i] = re[j]; re[j] = tr;
        var ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
    }
    for (var len = 2; len <= n; len <<= 1) {
      var ang = sign * 2 * Math.PI / len;
      var wr = Math.cos(ang), wi = Math.sin(ang);
      for (var s = 0; s < n; s += len) {
        var cwr = 1, cwi = 0;
        var half = len >> 1;
        for (var k = 0; k < half; k++) {
          var a = s + k, b = s + k + half;
          var xr = re[b] * cwr - im[b] * cwi;
          var xi = re[b] * cwi + im[b] * cwr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr;        im[a] += xi;
          var ncwr = cwr * wr - cwi * wi;
          cwi = cwr * wi + cwi * wr; cwr = ncwr;
        }
      }
    }
  }

  // Bluestein (chirp-z) for arbitrary length n. sign as above, no normalization.
  function fftBluestein(re, im, n, sign) {
    var m = 1;
    while (m < 2 * n - 1) m <<= 1;
    var ar = new Float64Array(m), ai = new Float64Array(m);
    var br = new Float64Array(m), bi = new Float64Array(m);
    var cosT = new Float64Array(n), sinT = new Float64Array(n);
    for (var i = 0; i < n; i++) {
      // angle = sign * pi * (i^2 mod 2n) / n  (mod to keep precision)
      var j = (i * i) % (2 * n);
      var ang = sign * Math.PI * j / n;
      cosT[i] = Math.cos(ang); sinT[i] = Math.sin(ang);
      // a[i] = x[i] * b[i], with chirp b[i] = cos + i*sin
      ar[i] = re[i] * cosT[i] - im[i] * sinT[i];
      ai[i] = re[i] * sinT[i] + im[i] * cosT[i];
    }
    // convolution kernel = conj(chirp) = cos - i*sin, for i in [0,n) and mirrored
    br[0] = cosT[0]; bi[0] = -sinT[0];
    for (var k = 1; k < n; k++) {
      br[k] = br[m - k] = cosT[k];
      bi[k] = bi[m - k] = -sinT[k];
    }
    fftRadix2(ar, ai, m, -1);
    fftRadix2(br, bi, m, -1);
    for (var t = 0; t < m; t++) {
      var rr = ar[t] * br[t] - ai[t] * bi[t];
      var ii = ar[t] * bi[t] + ai[t] * br[t];
      ar[t] = rr; ai[t] = ii;
    }
    fftRadix2(ar, ai, m, +1);
    var inv = 1 / m;
    for (var p = 0; p < n; p++) {
      var xr = ar[p] * inv, xi = ai[p] * inv;
      // multiply by chirp b[k] = cos + i*sin
      re[p] = xr * cosT[p] - xi * sinT[p];
      im[p] = xr * sinT[p] + xi * cosT[p];
    }
  }

  function transform1d(re, im, n, sign) {
    if (n <= 1) return;
    if (isPow2(n)) fftRadix2(re, im, n, sign);
    else fftBluestein(re, im, n, sign);
  }

  // 2D transform of a single channel stored in re/im (length nx*ny), in place.
  // sign = -1 forward, +1 inverse (unnormalized). Matches fftw row/col order.
  var _rowR = null, _rowI = null;
  function ensureScratch(n) {
    if (!_rowR || _rowR.length < n) { _rowR = new Float64Array(n); _rowI = new Float64Array(n); }
  }
  function transform2dPlane(re, im, nx, ny, sign) {
    var x, y, idx;
    // transform each row (length nx)
    ensureScratch(Math.max(nx, ny));
    for (y = 0; y < ny; y++) {
      var off = y * nx;
      for (x = 0; x < nx; x++) { _rowR[x] = re[off + x]; _rowI[x] = im[off + x]; }
      transform1d(_rowR, _rowI, nx, sign);
      for (x = 0; x < nx; x++) { re[off + x] = _rowR[x]; im[off + x] = _rowI[x]; }
    }
    // transform each column (length ny)
    for (x = 0; x < nx; x++) {
      for (y = 0; y < ny; y++) { idx = x + y * nx; _rowR[y] = re[idx]; _rowI[y] = im[idx]; }
      transform1d(_rowR, _rowI, ny, sign);
      for (y = 0; y < ny; y++) { idx = x + y * nx; re[idx] = _rowR[y]; im[idx] = _rowI[y]; }
    }
  }

  // ---- High-level helpers mirroring toolbox.cpp ----

  // Allocate a complex multi-channel buffer.
  function allocComplex(N) { return { re: new Float64Array(N), im: new Float64Array(N) }; }

  // do_fft_real: forward FFT of a real planar array `inReal` (length nx*ny*nz).
  function fftReal(out, inReal, nx, ny, nz) {
    var N = nx * ny;
    for (var k = 0; k < nz; k++) {
      var off = k * N;
      for (var i = 0; i < N; i++) { out.re[off + i] = inReal[off + i]; out.im[off + i] = 0; }
      var subR = out.re.subarray(off, off + N), subI = out.im.subarray(off, off + N);
      transform2dPlane(subR, subI, nx, ny, -1);
    }
  }

  // do_fft: forward FFT of a complex planar array (in -> out).
  function fft(out, inC, nx, ny, nz) {
    var N = nx * ny;
    for (var k = 0; k < nz; k++) {
      var off = k * N;
      out.re.set(inC.re.subarray(off, off + N), off);
      out.im.set(inC.im.subarray(off, off + N), off);
      transform2dPlane(out.re.subarray(off, off + N), out.im.subarray(off, off + N), nx, ny, -1);
    }
  }

  // do_ifft: inverse FFT (complex -> complex), normalized by 1/N.
  function ifft(out, inC, nx, ny, nz) {
    var N = nx * ny, norm = 1 / N;
    for (var k = 0; k < nz; k++) {
      var off = k * N;
      out.re.set(inC.re.subarray(off, off + N), off);
      out.im.set(inC.im.subarray(off, off + N), off);
      var subR = out.re.subarray(off, off + N), subI = out.im.subarray(off, off + N);
      transform2dPlane(subR, subI, nx, ny, +1);
      for (var i = 0; i < N; i++) { subR[i] *= norm; subI[i] *= norm; }
    }
  }

  // do_ifft_real: real part of inverse FFT, normalized by 1/N.
  function ifftReal(outReal, inC, nx, ny, nz) {
    var N = nx * ny, norm = 1 / N;
    var tmpR = new Float64Array(N), tmpI = new Float64Array(N);
    for (var k = 0; k < nz; k++) {
      var off = k * N;
      tmpR.set(inC.re.subarray(off, off + N));
      tmpI.set(inC.im.subarray(off, off + N));
      transform2dPlane(tmpR, tmpI, nx, ny, +1);
      for (var i = 0; i < N; i++) outReal[off + i] = tmpR[i] * norm;
    }
  }

  // pointwise_complexfloat_multiplication: comp_out = comp_in .* float_in
  // float_in is a single-channel real filter of length N applied to each channel.
  function pointwiseCFMul(out, inC, filt, N, nz) {
    for (var k = 0; k < nz; k++) {
      var off = k * N;
      for (var i = 0; i < N; i++) {
        out.re[off + i] = inC.re[off + i] * filt[i];
        out.im[off + i] = inC.im[off + i] * filt[i];
      }
    }
  }

  // upsampling by factor 2 in the Fourier domain (toolbox.cpp upsampling).
  // nx, ny are the SMALL sizes (before zoom). out is sized (2nx)(2ny)*nz.
  function upsampling(out, inC, nx, ny, nz) {
    var nx2 = ((nx + 1) / 2) | 0;
    var ny2 = ((ny + 1) / 2) | 0;
    var big = 4 * nx * ny;
    for (var l = 0; l < big * nz; l++) { out.re[l] = 0; out.im[l] = 0; }
    var r, l2, rr, ll, k;
    for (r = 0; r < ny; r++) {
      rr = (r < ny2) ? r : r + ny;
      for (l2 = 0; l2 < nx; l2++) {
        ll = (l2 < nx2) ? l2 : l2 + nx;
        for (k = 0; k < nz; k++) {
          var dst = ll + rr * 2 * nx + k * big;
          var src = l2 + r * nx + k * nx * ny;
          out.re[dst] = 4 * inC.re[src];
          out.im[dst] = 4 * inC.im[src];
        }
      }
    }
    if (nx % 2 === 0) {
      var lc = nx2, llc = nx2 + nx;
      for (r = 0; r < ny; r++) {
        rr = (r < ny2) ? r : r + ny;
        for (k = 0; k < nz; k++) {
          var a = llc + rr * 2 * nx + k * big;
          var b = lc + rr * 2 * nx + k * big;
          out.re[a] *= 0.5; out.im[a] *= 0.5;
          out.re[b] = out.re[a]; out.im[b] = out.im[a];
        }
      }
    }
    if (ny % 2 === 0) {
      var rc = ny2, rrc = ny2 + ny;
      for (l2 = 0; l2 < nx; l2++) {
        ll = (l2 < nx2) ? l2 : l2 + nx;
        for (k = 0; k < nz; k++) {
          var a2 = ll + rrc * 2 * nx + k * big;
          var b2 = ll + rc * 2 * nx + k * big;
          out.re[a2] *= 0.5; out.im[a2] *= 0.5;
          out.re[b2] = out.re[a2]; out.im[b2] = out.im[a2];
        }
      }
    }
    if (nx % 2 === 0 && ny % 2 === 0) {
      var L = nx2, LL = nx2 + nx, R = ny2, RR = ny2 + ny;
      for (k = 0; k < nz; k++) {
        var s = L + R * nx + k * nx * ny;
        var t0 = inC.re[s], t1 = inC.im[s];
        var i1 = L + R * 2 * nx + k * big, i2 = LL + R * 2 * nx + k * big,
            i3 = L + RR * 2 * nx + k * big, i4 = LL + RR * 2 * nx + k * big;
        out.re[i1] = out.re[i2] = out.re[i3] = out.re[i4] = t0;
        out.im[i1] = out.im[i2] = out.im[i3] = out.im[i4] = t1;
      }
    }
  }

  // downsampling by factor 2 in the Fourier domain (toolbox.cpp downsampling).
  // nx, ny are the SMALL sizes (after zoom). in is sized (2nx)(2ny)*nz.
  function downsampling(out, inC, nx, ny, nz) {
    var nx2 = ((nx + 1) / 2) | 0;
    var ny2 = ((ny + 1) / 2) | 0;
    var norm = 0.25, big = 4 * nx * ny;
    var r, l2, rr, ll, k;
    for (r = 0; r < ny; r++) {
      rr = (r < ny2) ? r : r + ny;
      for (l2 = 0; l2 < nx; l2++) {
        ll = (l2 < nx2) ? l2 : l2 + nx;
        for (k = 0; k < nz; k++) {
          var dst = l2 + r * nx + k * nx * ny;
          var src = ll + rr * 2 * nx + 4 * k * nx * ny;
          out.re[dst] = inC.re[src] * norm;
          out.im[dst] = inC.im[src] * norm;
        }
      }
    }
    if (nx % 2 === 0) {
      ll = nx2;
      for (r = 0; r < ny; r++) {
        rr = (r < ny2) ? r : r + ny;
        for (k = 0; k < nz; k++) {
          var dst2 = ll + r * nx + k * nx * ny;
          var src2 = ll + rr * nx * 2 + 4 * k * nx * ny;
          out.re[dst2] += inC.re[src2] * norm;
          out.im[dst2] += inC.im[src2] * norm;
        }
      }
    }
    if (ny % 2 === 0) {
      rr = ny2;
      for (l2 = 0; l2 < nx; l2++) {
        ll = (l2 < nx2) ? l2 : l2 + nx;
        for (k = 0; k < nz; k++) {
          var dst3 = l2 + rr * nx + k * nx * ny;
          var src3 = ll + rr * nx * 2 + 4 * k * nx * ny;
          out.re[dst3] += inC.re[src3] * norm;
          out.im[dst3] += inC.im[src3] * norm;
        }
      }
    }
    if (nx % 2 === 0 && ny % 2 === 0) {
      var L = nx2, LL = nx2 + nx, R = ny2, RR = ny2 + ny;
      for (k = 0; k < nz; k++) {
        var d = L + R * nx + k * nx * ny;
        out.re[d] = norm * (inC.re[L + 2 * R * nx + 4 * k * nx * ny] +
                            inC.re[LL + 2 * R * nx + 4 * k * nx * ny] +
                            inC.re[L + 2 * RR * nx + 4 * k * nx * ny] +
                            inC.re[LL + 2 * RR * nx + 4 * k * nx * ny]);
        out.im[d] = norm * (inC.im[L + 2 * R * nx + 4 * k * nx * ny] +
                            inC.im[LL + 2 * R * nx + 4 * k * nx * ny] +
                            inC.im[L + 2 * RR * nx + 4 * k * nx * ny] +
                            inC.im[LL + 2 * RR * nx + 4 * k * nx * ny]);
      }
    }
  }

  var FFT = {
    transform1d: transform1d,
    transform2dPlane: transform2dPlane,
    allocComplex: allocComplex,
    fftReal: fftReal, fft: fft, ifft: ifft, ifftReal: ifftReal,
    pointwiseCFMul: pointwiseCFMul,
    upsampling: upsampling, downsampling: downsampling
  };

  root.PS = root.PS || {};
  root.PS.FFT = FFT;
  if (typeof module !== 'undefined' && module.exports) module.exports = FFT;
})(typeof globalThis !== 'undefined' ? globalThis : this);
