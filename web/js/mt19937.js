// Mersenne Twister MT19937, a faithful port of reference/src/external/mt19937ar.cpp.
// Produces bit-identical sequences to the C reference, so the tiny analysis
// noise and the synthesis noise initialization match exactly.
(function (root) {
  'use strict';
  var N = 624, M = 397;
  var MATRIX_A = 0x9908b0df, UPPER_MASK = 0x80000000, LOWER_MASK = 0x7fffffff;

  function MT(seed) {
    this.mt = new Uint32Array(N);
    this.mti = N + 1;
    this.init(seed >>> 0);
  }
  MT.prototype.init = function (s) {
    this.mt[0] = s >>> 0;
    for (var mti = 1; mti < N; mti++) {
      var prev = this.mt[mti - 1] ^ (this.mt[mti - 1] >>> 30);
      // 1812433253 * prev + mti, modulo 2^32
      this.mt[mti] = (Math.imul(1812433253, prev) + mti) >>> 0;
    }
    this.mti = N;
  };
  MT.prototype.genrandInt32 = function () {
    var y, kk, mt = this.mt;
    var mag01 = [0, MATRIX_A];
    if (this.mti >= N) {
      for (kk = 0; kk < N - M; kk++) {
        y = (mt[kk] & UPPER_MASK) | (mt[kk + 1] & LOWER_MASK);
        mt[kk] = (mt[kk + M] ^ (y >>> 1) ^ mag01[y & 1]) >>> 0;
      }
      for (; kk < N - 1; kk++) {
        y = (mt[kk] & UPPER_MASK) | (mt[kk + 1] & LOWER_MASK);
        mt[kk] = (mt[kk + (M - N)] ^ (y >>> 1) ^ mag01[y & 1]) >>> 0;
      }
      y = (mt[N - 1] & UPPER_MASK) | (mt[0] & LOWER_MASK);
      mt[N - 1] = (mt[M - 1] ^ (y >>> 1) ^ mag01[y & 1]) >>> 0;
      this.mti = 0;
    }
    y = mt[this.mti++];
    y ^= (y >>> 11);
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= (y >>> 18);
    return y >>> 0;
  };
  // [0,1) with 53-bit resolution -- matches mt_genrand_res53.
  MT.prototype.genrandRes53 = function () {
    var a = this.genrandInt32() >>> 5, b = this.genrandInt32() >>> 6;
    return (a * 67108864.0 + b) * (1.0 / 9007199254740992.0);
  };

  root.PS = root.PS || {};
  root.PS.MT = MT;
  if (typeof module !== 'undefined' && module.exports) module.exports = MT;
})(typeof globalThis !== 'undefined' ? globalThis : this);
