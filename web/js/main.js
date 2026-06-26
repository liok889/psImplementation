// Browser UI controller for the Portilla-Simoncelli texture model.
// Wires the PS.* modules to image upload, pyramid visualization, statistics
// display, and iterative synthesis with a live preview.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var state = { gray: null, cropped: null, analysis: null, params: null, stop: false,
                running: false, synthStats: null, synthDims: null, lastSeed: null };

  // ---- statistics serialization / export ----
  // statsToObject lives in js/statsjson.js (PS.StatsJSON) so it is unit-testable
  // headlessly. It returns { meta, annotated[], raw[] } -- see that file.
  var statsToObject = PS.StatsJSON.statsToObject;
  function downloadText(text, filename, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.parentNode && a.parentNode.removeChild(a); }, 200);
  }
  function downloadJSON(obj, filename) { downloadText(JSON.stringify(obj, null, 2), filename, 'application/json'); }

  // ---- image helpers ----
  function loadImage(src) {
    return new Promise(function (res, rej) {
      var im = new Image(); im.crossOrigin = "anonymous";
      im.onload = function () { res(im); }; im.onerror = rej; im.src = src;
    });
  }
  // HTMLImage -> {image: planar gray Float64Array, nx, ny, nz:1} + rgba for preview
  function imageToGray(img) {
    var nx = img.naturalWidth, ny = img.naturalHeight;
    var c = document.createElement('canvas'); c.width = nx; c.height = ny;
    var ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    var d = ctx.getImageData(0, 0, nx, ny).data;
    var gray = new Float64Array(nx * ny);
    for (var j = 0; j < ny; j++) for (var i = 0; i < nx; i++) {
      var p = (j * nx + i) * 4;
      gray[i + j * nx] = (d[p] + d[p + 1] + d[p + 2]) / 3;
    }
    return { image: gray, nx: nx, ny: ny, nz: 1, rgba: d };
  }
  // Centered crop to a multiple of 2^(N_pyr+1); clamp N_pyr like the reference main().
  function cropForPyramid(data, N_pyr, Na) {
    var minSize = Math.min(data.nx, data.ny);
    var N_pyr_max = Math.floor((Math.log(minSize) - Math.log(Na + 1)) / Math.log(2) - 1);
    if (N_pyr_max < 1) N_pyr_max = 1;
    if (N_pyr > N_pyr_max) N_pyr = N_pyr_max;
    var pow = 1 << (N_pyr + 1);
    var remx = data.nx % pow, remy = data.ny % pow;
    var rx = (remx / 2) | 0, ry = (remy / 2) | 0;
    var nx = data.nx - remx, ny = data.ny - remy;
    var out = new Float64Array(nx * ny);
    for (var j = 0; j < ny; j++) for (var i = 0; i < nx; i++)
      out[i + j * nx] = data.image[(i + rx) + (j + ry) * data.nx];
    return { data: { image: out, nx: nx, ny: ny, nz: 1 }, N_pyr: N_pyr };
  }

  // ---- rendering ----
  function renderToCanvas(canvas, arr, sx, sy, opts) {
    opts = opts || {};
    var mn = opts.min, mx = opts.max;
    if (mn === undefined || mx === undefined) {
      mn = Infinity; mx = -Infinity;
      for (var t = 0; t < sx * sy; t++) { var v = arr[t]; if (v < mn) mn = v; if (v > mx) mx = v; }
    }
    var rng = (mx - mn) || 1;
    var off = document.createElement('canvas'); off.width = sx; off.height = sy;
    var octx = off.getContext('2d'); var id = octx.createImageData(sx, sy);
    for (var i = 0; i < sx * sy; i++) {
      var g = Math.round(255 * (arr[i] - mn) / rng);
      g = g < 0 ? 0 : g > 255 ? 255 : g;
      id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = g; id.data[i * 4 + 3] = 255;
    }
    octx.putImageData(id, 0, 0);
    var disp = opts.size || 120;
    // keep aspect ratio
    var scale = disp / Math.max(sx, sy);
    canvas.width = Math.max(1, Math.round(sx * scale));
    canvas.height = Math.max(1, Math.round(sy * scale));
    var ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
  }
  // fftshift a single-channel real array (DC -> center) for filter display
  function fftshift(arr, nx, ny) {
    var out = new Float64Array(nx * ny), hx = (nx / 2) | 0, hy = (ny / 2) | 0;
    for (var y = 0; y < ny; y++) for (var x = 0; x < nx; x++)
      out[x + y * nx] = arr[((x + hx) % nx) + ((y + hy) % ny) * nx];
    return out;
  }
  function tile(parent, sx, sy, cap, draw, size) {
    var d = document.createElement('div'); d.className = 'tile';
    var cv = document.createElement('canvas'); d.appendChild(cv);
    var c = document.createElement('div'); c.className = 'cap'; c.textContent = cap; d.appendChild(c);
    parent.appendChild(d); draw(cv); return cv;
  }
  function magnitude(band, n) { var m = new Float64Array(n); for (var i = 0; i < n; i++) m[i] = Math.hypot(band.re[i], band.im[i]); return m; }

  // ---- analysis flow ----
  function doAnalyze() {
    if (!state.gray) return;
    var N_pyr = parseInt($('npyr').value, 10), N_steer = parseInt($('nsteer').value, 10);
    var Na = parseInt($('na').value, 10), N_iter = parseInt($('niter').value, 10);
    var cr = cropForPyramid(state.gray, N_pyr, Na);
    state.cropped = cr.data; N_pyr = cr.N_pyr;
    var params = { N_steer: N_steer, N_pyr: N_pyr, N_iteration: N_iter, Na: Na, noise: 0,
                   edge_handling: 0, add_smooth: 0, cmask: [1, 1, 1, 1], verbose: 0,
                   interpWeight: -1, statistics: 0 };
    state.params = params;

    var note = $('paramNote');
    if (cr.N_pyr !== parseInt($('npyr').value, 10))
      note.textContent = "Note: scales reduced to " + cr.N_pyr + " for this image size.";
    else note.textContent = "";
    $('grayCap').textContent = "grayscale " + cr.data.nx + "×" + cr.data.ny + " (cropped)";
    renderToCanvas($('grayCanvas'), cr.data.image, cr.data.nx, cr.data.ny, { size: 180 });

    var t0 = performance.now();
    var mt = new PS.MT(0);
    var res = PS.Analysis.analysis(cr.data, params, mt);
    state.analysis = res;
    var dt = Math.round(performance.now() - t0);

    renderFilters(res.filters, params);
    renderPyramid(res.pyramid, params);
    renderStats(res.stats, params, dt);
    $('targetCanvas') && renderToCanvas($('targetCanvas'), cr.data.image, cr.data.nx, cr.data.ny, { size: 220 });
    // reset stats viewer / synthesized-stats export for the new analysis
    $('statsDump').classList.add('hidden'); $('statsDump').textContent = '';
    $('showAllBtn').textContent = 'Show all statistics';
    $('exportSynthStatsBtn').classList.add('hidden'); state.synthStats = null;

    $('filtersPanel').classList.remove('hidden');
    $('analysisPanel').classList.remove('hidden');
    $('statsPanel').classList.remove('hidden');
    $('synthPanel').classList.remove('hidden');
  }

  function renderFilters(filters, params) {
    var g = $('filterGallery'); g.innerHTML = '';
    var nx = filters.size[0], ny = filters.size[1];
    tile(g, nx, ny, 'H₀ high-pass', function (cv) { renderToCanvas(cv, fftshift(filters.highpass0, nx, ny), nx, ny, { size: 120, min: 0 }); });
    tile(g, nx, ny, 'L₀ low-pass', function (cv) { renderToCanvas(cv, fftshift(filters.lowpass0[0], nx, ny), nx, ny, { size: 120, min: 0 }); });
    for (var j = 0; j < params.N_steer; j++) (function (j) {
      tile(g, nx, ny, 'oriented k=' + j, function (cv) { renderToCanvas(cv, fftshift(filters.steered[j], nx, ny), nx, ny, { size: 120, min: 0 }); });
    })(j);
  }

  function renderPyramid(pyr, params) {
    var rg = $('residGallery'); rg.innerHTML = '';
    var nx = pyr.size[0], ny = pyr.size[1];
    tile(rg, nx, ny, 'high-pass residual', function (cv) { renderToCanvas(cv, pyr.highband, nx, ny, { size: 130 }); });
    var last = params.N_pyr, lsx = pyr.size[2 * last], lsy = pyr.size[2 * last + 1];
    tile(rg, lsx, lsy, 'low-pass residual', function (cv) { renderToCanvas(cv, pyr.lowband[last], lsx, lsy, { size: 130 }); });

    var grid = $('scaleGrid'); grid.innerHTML = '';
    for (var i = 0; i < params.N_pyr; i++) {
      var sx = pyr.size[2 * i], sy = pyr.size[2 * i + 1];
      var row = document.createElement('div'); row.className = 'scalerow';
      var lbl = document.createElement('div'); lbl.className = 'lbl';
      lbl.textContent = 'scale ' + i + ' (' + sx + '×' + sy + ')'; row.appendChild(lbl);
      for (var j = 0; j < params.N_steer; j++) (function (i, j, sx, sy) {
        var band = pyr.steered[i * params.N_steer + j];
        tile(row, sx, sy, 'k=' + j, function (cv) { renderToCanvas(cv, magnitude(band, sx * sy), sx, sy, { size: 96, min: 0 }); });
      })(i, j, sx, sy);
      (function (i, sx, sy) {
        tile(row, sx, sy, 'low ' + i, function (cv) { renderToCanvas(cv, pyr.lowband[i], sx, sy, { size: 96 }); });
      })(i, sx, sy);
      grid.appendChild(row);
    }
  }

  function renderStats(stats, params, dt) {
    var T = $('statsTable'); T.innerHTML = '';
    function rowKV(k, v) { var tr = document.createElement('tr');
      tr.innerHTML = '<td class="k">' + k + '</td><td class="v">' + v + '</td>'; T.appendChild(tr); }
    var ps = stats.pixelStats;
    rowKV('pixel min / max', ps[0].toFixed(2) + ' / ' + ps[1].toFixed(2));
    rowKV('pixel mean', ps[2].toFixed(3));
    rowKV('pixel variance', ps[3].toFixed(2));
    rowKV('pixel skewness', ps[4].toFixed(4));
    rowKV('pixel kurtosis', ps[5].toFixed(4));
    rowKV('high-pass variance', stats.varHigh[0].toFixed(4));
    rowKV('low-band skew (coarsest)', stats.skewLow[params.N_pyr].toFixed(4));
    rowKV('low-band kurt (coarsest)', stats.kurtLow[params.N_pyr].toFixed(4));
    var nP = params.N_pyr, nK = params.N_steer, Na = params.Na;
    var total = 6 + 2 * (1 + nP) + 1 + nP * nK + (1 + nP) * Na * Na +
                nP * nK * Na * Na + nP * nK * nK + (nP - 1) * nK * nK + (nP - 1) * 2 * nK * nK;
    $('statsCounts').innerHTML = 'Analysis in <b>' + dt + ' ms</b>. About <b>' + total +
      '</b> scalar constraints' +
      ' <span class="pill">P=' + nP + '</span><span class="pill">K=' + nK + '</span><span class="pill">Na=' + Na + '</span>';
  }

  // ---- synthesis flow (stepper, yields to UI each iteration) ----
  function yieldUI() { return new Promise(function (r) { setTimeout(r, 0); }); }

  async function doSynthesize() {
    if (!state.analysis || state.running) return;
    state.running = true; state.stop = false;
    $('synthBtn').disabled = true; $('stopBtn').disabled = false;
    $('dlLink').classList.add('hidden'); $('exportSynthStatsBtn').classList.add('hidden');
    var params = state.params, stats = state.analysis.stats;
    var nx = state.cropped.nx, ny = state.cropped.ny;
    var tex = { image: new Float64Array(nx * ny), nx: nx, ny: ny, nz: 1 };
    var filters = PS.Filters.computeFilters(nx, ny, params.N_pyr, params.N_steer, 0);

    // seed: blank -> fresh pseudo-random seed; otherwise the entered integer
    var seedField = ($('seed').value || '').trim();
    var seed;
    if (seedField === '') seed = (Math.random() * 4294967296) >>> 0;
    else { seed = parseInt(seedField, 10); if (!isFinite(seed)) seed = (Math.random() * 4294967296) >>> 0; seed = seed >>> 0; }
    state.lastSeed = seed;
    var mt = new PS.MT(seed);

    // initial noise (Line 3)
    var factor = Math.sqrt(stats.pixelStats[3]);
    for (var p = 0; p < nx * ny; p++) {
      var u1 = mt.genrandRes53(), u2 = mt.genrandRes53();
      tex.image[p] = stats.pixelStats[2] + factor * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }
    var tmp = new Float64Array(tex.image);

    for (var k = 0; k < params.N_iteration; k++) {
      if (state.stop) break;
      var pyr = PS.Pyramid.createPyramid(tex, filters, params, 0);
      PS.Synthesis.adjustConstraints(tex, stats, pyr, filters, params);
      // convergence accelerator (Line 8)
      if (k < params.N_iteration - 1)
        for (var ii = 0; ii < nx * ny; ii++) { var nv = tex.image[ii]; tex.image[ii] += 0.8 * (tex.image[ii] - tmp[ii]); tmp[ii] = nv; }

      renderToCanvas($('synthCanvas'), tex.image, nx, ny, { size: 220, min: stats.pixelStats[0], max: stats.pixelStats[1] });
      var prog = Math.round(100 * (k + 1) / params.N_iteration);
      $('progBar').style.width = prog + '%';
      var m = PS.Stats.mean(tex.image, nx * ny, 0), v = PS.Stats.computeMoment(tex.image, m, 2, nx * ny, 0);
      $('progText').textContent = 'seed ' + state.lastSeed + '  ·  iteration ' + (k + 1) + '/' + params.N_iteration +
        '  ·  mean ' + m.toFixed(2) + '  var ' + v.toFixed(1);
      await yieldUI();
    }

    // final image already range-adjusted; build PNG download
    var out = document.createElement('canvas'); out.width = nx; out.height = ny;
    var octx = out.getContext('2d'); var id = octx.createImageData(nx, ny);
    for (var i = 0; i < nx * ny; i++) { var g = Math.round(tex.image[i]); g = g < 0 ? 0 : g > 255 ? 255 : g; id.data[i*4]=id.data[i*4+1]=id.data[i*4+2]=g; id.data[i*4+3]=255; }
    octx.putImageData(id, 0, 0);
    $('dlLink').href = out.toDataURL('image/png'); $('dlLink').classList.remove('hidden');

    // re-analyze the synthesized texture so its statistics can be inspected/exported
    var reAnalyzed = PS.Analysis.analysis({ image: new Float64Array(tex.image), nx: nx, ny: ny, nz: 1 }, params, new PS.MT(0)).stats;
    state.synthStats = reAnalyzed; state.synthDims = { nx: nx, ny: ny };
    $('exportSynthStatsBtn').classList.remove('hidden');

    var mo = PS.Stats.mean(tex.image, nx*ny, 0), vo = PS.Stats.computeMoment(tex.image, mo, 2, nx*ny, 0);
    var sko = PS.Stats.computeSkewness(tex.image, mo, vo, nx*ny, 0), kuo = PS.Stats.computeKurtosis(tex.image, mo, vo, nx*ny, 0);
    $('convText').innerHTML = 'Seed <b>' + state.lastSeed + '</b>. Converged output vs target &mdash; mean ' + mo.toFixed(2) + ' / ' + stats.pixelStats[2].toFixed(2) +
      ', var ' + vo.toFixed(1) + ' / ' + stats.pixelStats[3].toFixed(1) +
      ', skew ' + sko.toFixed(3) + ' / ' + stats.pixelStats[4].toFixed(3) +
      ', kurt ' + kuo.toFixed(3) + ' / ' + stats.pixelStats[5].toFixed(3) + '.';
    $('progText').textContent = (state.stop ? 'stopped' : 'done') + '  ·  seed ' + state.lastSeed;
    state.running = false; $('synthBtn').disabled = false; $('stopBtn').disabled = true;
  }

  // ---- wiring ----
  function setInput(img) {
    state.gray = imageToGray(img);
    renderToCanvas($('origCanvas'), state.gray.image, state.gray.nx, state.gray.ny, { size: 180 });
    // also draw true color original
    var oc = $('origCanvas'); var ctx = oc.getContext('2d');
    var scale = 180 / Math.max(state.gray.nx, state.gray.ny);
    oc.width = Math.round(state.gray.nx * scale); oc.height = Math.round(state.gray.ny * scale);
    ctx.imageSmoothingEnabled = true; ctx.drawImage(img, 0, 0, oc.width, oc.height);
    $('analyzeBtn').disabled = false;
  }

  $('file').addEventListener('change', function (e) {
    var f = e.target.files[0]; if (!f) return;
    var url = URL.createObjectURL(f); loadImage(url).then(setInput);
  });
  $('loadSample').addEventListener('click', function () {
    loadImage('../reference/data/sample.png').then(setInput).catch(function () {
      $('paramNote').textContent = 'Could not load sample (serve the repo over http and keep reference/data/sample.png).';
    });
  });
  $('analyzeBtn').addEventListener('click', doAnalyze);
  $('synthBtn').addEventListener('click', doSynthesize);
  $('stopBtn').addEventListener('click', function () { state.stop = true; });

  $('showAllBtn').addEventListener('click', function () {
    var pre = $('statsDump');
    if (!pre.classList.contains('hidden')) { pre.classList.add('hidden'); this.textContent = 'Show all statistics'; return; }
    if (!state.analysis) return;
    pre.textContent = JSON.stringify(
      statsToObject(state.analysis.stats, state.params, { nx: state.cropped.nx, ny: state.cropped.ny }, 'analysis(input)'), null, 2);
    pre.classList.remove('hidden'); this.textContent = 'Hide statistics';
  });
  $('exportStatsBtn').addEventListener('click', function () {
    if (!state.analysis) return;
    downloadJSON(statsToObject(state.analysis.stats, state.params,
      { nx: state.cropped.nx, ny: state.cropped.ny }, 'analysis(input)'), 'statistics_input.json');
  });
  // raw CSV: the "raw" array only, one comma-separated line, no header
  $('exportCsvBtn').addEventListener('click', function () {
    if (!state.analysis) return;
    var obj = statsToObject(state.analysis.stats, state.params,
      { nx: state.cropped.nx, ny: state.cropped.ny }, 'analysis(input)');
    downloadText(obj.raw.join(',') + '\n', 'statistics_input_raw.csv', 'text/csv');
  });
  $('exportSynthStatsBtn').addEventListener('click', function () {
    if (!state.synthStats) return;
    var obj = statsToObject(state.synthStats, state.params, state.synthDims,
      'analysis(synthesized, seed=' + state.lastSeed + ')');
    obj.meta.synthesisSeed = state.lastSeed;
    downloadJSON(obj, 'statistics_synthesized_seed' + state.lastSeed + '.json');
  });

  // ---- handoff from the correlation_percepts tool (same-origin, no upload) ----
  // The sender writes a PNG data URL to localStorage['ps_incoming'] and opens/
  // reuses this window. A freshly opened window reads it on load; an already-open
  // window reacts live via the 'storage' event. We then run the analysis only.
  var _lastHandoffTs = 0;
  function handleHandoff(payload) {
    if (!payload || !payload.dataURL) return;
    if (payload.ts && payload.ts === _lastHandoffTs) return; // de-dupe
    _lastHandoffTs = payload.ts || Date.now();
    loadImage(payload.dataURL).then(function (img) {
      setInput(img);
      doAnalyze();                         // analysis only (no synthesis)
      var note = $('paramNote');
      if (note) note.textContent = 'Received from the correlation tool' +
        (payload.src ? ' (' + payload.src + ')' : '') + ' — analysis run automatically.';
      window.focus();
    });
  }
  (function initHandoff() {
    try {
      var raw = localStorage.getItem('ps_incoming');
      if (raw) { localStorage.removeItem('ps_incoming'); handleHandoff(JSON.parse(raw)); }
    } catch (e) {}
    window.addEventListener('storage', function (e) {
      if (e.key !== 'ps_incoming' || !e.newValue) return;
      var p; try { p = JSON.parse(e.newValue); } catch (err) { return; }
      try { localStorage.removeItem('ps_incoming'); } catch (err) {}
      handleHandoff(p);
    });
  })();
})();
