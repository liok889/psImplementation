// Shared stimulus-collection logic used by BOTH the browser generator
// (js/app.js) and the command-line generator (cli/gen_stimuli.js), so the two
// produce byte-identical task lists and CSV rows given the same RNG stream.
//
// This module owns everything about the collection *procedure* and *CSV format*;
// it is deliberately independent of how a plot is turned into pixels (canvas in
// the browser, CorrRaster in the CLI) and of the PS analysis. UMD-style: attaches
// to a global `CorrCollection` in the browser, a Web Worker, and `jsc`.
(function (root) {
  'use strict';

  // mulberry32 — small seedable PRNG so the CLI can generate reproducible
  // collections. The browser passes Math.random for a fresh set each run.
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Build the list of plot "tasks". For each participant (a full replication of
  // the design) and each base level, `cfg.n` pairs: one plot at exactly rbase,
  // the other at r ~ Uniform[rbase-range, rbase+range] cropped to [0,1]; which
  // side (L/R) holds the base is randomized. Negative sign negates both. Each
  // plot is one CSV row; the two rows of a pair are adjacent. `stimulus` restarts
  // per participant. `rng` is a function returning [0,1) (default Math.random).
  function buildTasks(cfg, rng) {
    rng = rng || Math.random;
    var tasks = [], line = 0;
    var participants = Math.max(1, cfg.participants || 1);
    for (var p = 1; p <= participants; p++) {
      var pair = 0;
      for (var bi = 0; bi < cfg.bases.length; bi++) {
        var rb = cfg.bases[bi];
        var lo = Math.max(0, rb - cfg.range), hi = Math.min(1, rb + cfg.range);
        for (var k = 0; k < cfg.n; k++) {
          pair++;
          var rOther = lo + rng() * (hi - lo);
          var rbaseV = cfg.sign * rb, rOtherV = cfg.sign * rOther;
          var baseLeft = rng() < 0.5;
          var lb = line + (baseLeft ? 0 : 1);
          var lo2 = line + (baseLeft ? 1 : 0);
          line += 2;
          var seedBase = (rng() * 4294967296) >>> 0;
          var seedOther = (rng() * 4294967296) >>> 0;
          tasks[lb]  = { lineIndex: lb,  participant: p, stim: pair, rbase: rbaseV, r: rbaseV,  lr: baseLeft ? 'L' : 'R', seed: seedBase };
          tasks[lo2] = { lineIndex: lo2, participant: p, stim: pair, rbase: rbaseV, r: rOtherV, lr: baseLeft ? 'R' : 'L', seed: seedOther };
        }
      }
    }
    return tasks;
  }

  // Number formatting — identical on both paths so CSV bytes match.
  function fmtStat(v) { return isFinite(v) ? '' + (+v.toPrecision(7)) : '0'; }
  function fmtR(v) { return '' + (+v.toFixed(6)); }              // enough to reproduce the plot
  function visLabel(t) { return t === 'ordered' ? 'orderedlines' : t; }  // scatter | parallel | orderedlines

  // Metadata columns, in order, that precede the PS statistics.
  var META = ['stimulus', 'participant', 'vis', 'rbase', 'r', 'left_or_right', 'seed', 'npoints'];

  // Full CSV header given the PS statistic column keys (annotated[].key).
  function header(statKeys) { return META.concat(statKeys); }

  // One CSV row: metadata for task `t`, its npoints `n`, vis label, then the raw
  // PS statistics.
  function rowStr(t, raw, vis, n) {
    var a = new Array(META.length + raw.length);
    a[0] = t.stim; a[1] = t.participant; a[2] = vis; a[3] = fmtR(t.rbase);
    a[4] = fmtR(t.r); a[5] = t.lr; a[6] = t.seed; a[7] = n;
    for (var i = 0; i < raw.length; i++) a[META.length + i] = fmtStat(raw[i]);
    return a.join(',');
  }

  var api = {
    mulberry32: mulberry32, buildTasks: buildTasks,
    fmtStat: fmtStat, fmtR: fmtR, visLabel: visLabel,
    META: META, header: header, rowStr: rowStr
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CorrCollection = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
