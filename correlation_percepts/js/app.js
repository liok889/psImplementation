// UI controller for the bivariate-correlation dataset generator.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var state = { data: null, r: 0.6, n: 100 };

  function readControls() {
    return {
      r: parseFloat($('corr').value),
      n: Math.max(2, Math.min(20000, parseInt($('npoints').value, 10) || 2)),
      type: $('type').value,
      seedRaw: ($('seed').value || '').trim()
    };
  }

  function seedValue(raw) {
    if (raw === '') return null;            // random
    var v = parseInt(raw, 10);
    return isFinite(v) ? (v >>> 0) : null;
  }

  // (re)generate the dataset from r / n / seed
  function regenerate() {
    var c = readControls();
    state.r = c.r; state.n = c.n;
    state.data = CorrGen.generate(c.n, c.r, seedValue(c.seedRaw));
    draw();
    var achieved = CorrGen.pearson(state.data.map(function (d) { return d[0]; }),
                                   state.data.map(function (d) { return d[1]; }));
    $('corrVal').textContent = c.r.toFixed(2);
    $('achieved').textContent = 'target r = ' + c.r.toFixed(3) +
      '   ·   achieved sample r = ' + achieved.toFixed(6) + '   ·   n = ' + c.n;
  }

  // draw the current dataset to the on-screen canvas (chosen vis type)
  function draw() {
    if (!state.data) return;
    var c = readControls();
    var cv = $('display');
    var cssW = cv.clientWidth || 420, cssH = cssW; // square
    var dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
    cv.style.height = cssH + 'px';
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    CorrRender.render(ctx, state.data, {
      width: cssW, height: cssH, type: c.type, drawAxes: true
    });
  }

  // render the current dataset to a clean 256x256 canvas and download as PNG
  function exportPNG() {
    if (!state.data) return;
    var c = readControls();
    var size = 256;
    var cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    var ctx = cv.getContext('2d');
    CorrRender.render(ctx, state.data, {
      width: size, height: size, type: c.type, drawAxes: false,
      pad: 10,
      pointRadius: c.type === 'scatter' ? Math.max(1, 256 / 130) : undefined,
      lineWidth: c.type === 'parallel' ? Math.max(0.6, 256 / 320) : undefined
    });
    var rTag = (c.r < 0 ? 'm' : '') + Math.abs(c.r).toFixed(2).replace('.', '');
    var name = 'corr_' + c.type + '_r' + rTag + '_n' + c.n + '.png';
    var a = document.createElement('a');
    a.href = cv.toDataURL('image/png');
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { a.parentNode && a.parentNode.removeChild(a); }, 200);
    $('exportNote').textContent = 'saved ' + name + ' (256×256) — pipe it through the PS pipeline, e.g.  cli/ps_stats ' + name;
  }

  // wiring: r / n / seed regenerate; switching vis type only redraws (same data)
  $('corr').addEventListener('input', regenerate);
  $('npoints').addEventListener('change', regenerate);
  $('seed').addEventListener('change', regenerate);
  $('type').addEventListener('change', draw);
  $('regen').addEventListener('click', regenerate);
  $('export').addEventListener('click', exportPNG);
  window.addEventListener('resize', draw);

  regenerate();
})();
