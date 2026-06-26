// Serialize a statistics container into a two-part JSON object:
//   annotated[] : one entry per scalar -- names the statistic and locates it
//                 (scale / orientation / lag / parent band), plus its value.
//   raw[]       : the bare scalar array, index-aligned so raw[i] === annotated[i].value.
// The set is exactly the statistics imposed during synthesis (incl. magMeans),
// i.e. the Portilla-Simoncelli perceptual constraint set. Grayscale (nz=1).
(function (root) {
  'use strict';

  function statsToObject(stats, params, dims, label) {
    var P = params.N_pyr, K = params.N_steer, Na = params.Na, hNa = ((Na - 1) / 2) | 0;
    var annotated = [], raw = [];
    function push(value, statistic, ctx, key) {
      var e = { index: raw.length, key: key, statistic: statistic };
      for (var p in ctx) if (ctx.hasOwnProperty(p)) e[p] = ctx[p];
      e.value = value; annotated.push(e); raw.push(value);
    }
    var s, i, j, k, a, b, ind, dx, dy;

    // 1. pixel marginal statistics
    var pn = ["min", "max", "mean", "variance", "skewness", "kurtosis"];
    for (i = 0; i < 6; i++)
      push(stats.pixelStats[i], "pixel " + pn[i],
           { group: "pixelMarginal", measure: pn[i] }, "pixel." + pn[i]);

    // 2-3. low-band skewness / kurtosis per scale (0 = finest ... P = coarsest residual)
    for (i = 0; i < 1 + P; i++)
      push(stats.skewLow[i], "low-band skewness",
           { group: "lowbandMarginal", measure: "skewness", scale: i }, "lowband.skew.s" + i);
    for (i = 0; i < 1 + P; i++)
      push(stats.kurtLow[i], "low-band kurtosis",
           { group: "lowbandMarginal", measure: "kurtosis", scale: i }, "lowband.kurt.s" + i);

    // 4. high-pass residual variance
    push(stats.varHigh[0], "high-pass residual variance",
         { group: "highpassVariance", band: "high-pass residual", measure: "variance" }, "highpass.var");

    // 5. mean magnitude of each oriented band
    for (ind = 0; ind < P * K; ind++) {
      i = (ind / K) | 0; j = ind % K;
      push(stats.magMeans[ind], "mean band magnitude",
           { group: "magnitudeMean", scale: i, orientation: j }, "magMean.s" + i + ".o" + j);
    }

    // 6. central Na x Na auto-correlation of each low-band (lag (dx,dy) about center)
    for (i = 0; i < 1 + P; i++) {
      s = stats.autoCorLow[i];
      for (k = 0; k < Na * Na; k++) {
        dx = (k % Na) - hNa; dy = ((k / Na) | 0) - hNa;
        push(s[k], "auto-correlation (low-band)",
             { group: "autoCorrelation", on: "low-band", scale: i, lagX: dx, lagY: dy },
             "autoCorLow.s" + i + ".dx" + dx + ".dy" + dy);
      }
    }

    // 7. central Na x Na auto-correlation of each oriented band magnitude
    for (i = 0; i < P; i++) for (j = 0; j < K; j++) {
      s = stats.autoCorMag[j + i * K];
      for (k = 0; k < Na * Na; k++) {
        dx = (k % Na) - hNa; dy = ((k / Na) | 0) - hNa;
        push(s[k], "auto-correlation (band magnitude)",
             { group: "autoCorrelation", on: "band magnitude", scale: i, orientation: j, lagX: dx, lagY: dy },
             "autoCorMag.s" + i + ".o" + j + ".dx" + dx + ".dy" + dy);
      }
    }

    // 8. magnitude cross-correlation across orientations at the same scale (cousins)
    for (i = 0; i < P; i++) {
      s = stats.cousinMagCor[i];
      for (a = 0; a < K; a++) for (b = 0; b < K; b++)
        push(s[b + a * K], "cross-correlation (magnitude, same scale)",
             { group: "crossCorrelation", kind: "magnitude cousins", scale: i, orientation1: a, orientation2: b },
             "cousinMagCor.s" + i + ".o" + a + "_o" + b);
    }

    // 9. magnitude cross-correlation with the coarser scale (parents)
    for (i = 0; i < P - 1; i++) {
      s = stats.parentMagCor[i];
      for (a = 0; a < K; a++) for (b = 0; b < K; b++)
        push(s[b + a * K], "cross-correlation (magnitude, cross-scale)",
             { group: "crossCorrelation", kind: "magnitude parents", scale: i, coarserScale: i + 1,
               orientation: a, parentOrientation: b },
             "parentMagCor.s" + i + "_" + (i + 1) + ".o" + a + "_o" + b);
    }

    // 10. real/phase cross-correlation with the coarser scale (parents).
    //     parent bands: 0..K-1 = real part, K..2K-1 = imaginary part (phase-doubled).
    for (i = 0; i < P - 1; i++) {
      s = stats.parentRealCor[i];
      for (a = 0; a < K; a++) for (b = 0; b < 2 * K; b++) {
        var part = b < K ? "real" : "imag", po = b < K ? b : b - K;
        push(s[b + a * 2 * K], "cross-correlation (real/phase, cross-scale)",
             { group: "crossCorrelation", kind: "real/phase parents", scale: i, coarserScale: i + 1,
               orientation: a, parentOrientation: po, parentPart: part },
             "parentRealCor.s" + i + "_" + (i + 1) + ".o" + a + "_" + part + "o" + po);
      }
    }

    return {
      meta: {
        source: label, nx: dims.nx, ny: dims.ny, nz: 1, N_pyr: P, N_steer: K, Na: Na,
        totalScalars: raw.length,
        note: "Exactly the statistics imposed during synthesis (the Portilla-Simoncelli " +
              "perceptual constraint set), nothing more, nothing less. " +
              "'annotated' names/locates each scalar; 'raw' is the bare value array with " +
              "raw[i] === annotated[i].value. scale 0 = finest; lags (dx,dy) are about the " +
              "auto-correlation center; parent = next-coarser scale."
      },
      annotated: annotated,
      raw: raw
    };
  }

  root.PS = root.PS || {};
  root.PS.StatsJSON = { statsToObject: statsToObject };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PS.StatsJSON;
})(typeof globalThis !== 'undefined' ? globalThis : this);
