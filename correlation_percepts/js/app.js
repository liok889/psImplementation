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
      markSize: parseFloat($('marksize').value),   // px @ 256px export
      opacity: parseFloat($('opacity').value),
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

  function updateLabels(c) {
    $('sizeVal').textContent = c.markSize.toFixed(1);
    $('opacityVal').textContent = c.opacity.toFixed(2);
  }

  // draw the current dataset to the on-screen canvas (chosen vis type).
  // Mark size is specified in 256px-export units and scaled to the display so
  // the on-screen marks match the exported PNG (WYSIWYG).
  function draw() {
    if (!state.data) return;
    var c = readControls();
    updateLabels(c);
    var cv = $('display');
    var cssW = cv.clientWidth || 420, cssH = cssW; // square
    var dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
    cv.style.height = cssH + 'px';
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var scale = cssW / 256;
    CorrRender.render(ctx, state.data, {
      width: cssW, height: cssH, type: c.type, drawAxes: true, alpha: c.opacity,
      pointRadius: c.markSize * scale, lineWidth: c.markSize * scale
    });
  }

  // render the current dataset to a clean 256x256 canvas (marks only, no axes)
  function renderExportCanvas(c) {
    var size = 256;
    var cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    var ctx = cv.getContext('2d');
    CorrRender.render(ctx, state.data, {
      width: size, height: size, type: c.type, drawAxes: false, pad: 10,
      alpha: c.opacity, pointRadius: c.markSize, lineWidth: c.markSize
    });
    return cv;
  }
  function stimulusName(c) {
    var rTag = (c.r < 0 ? 'm' : '') + Math.abs(c.r).toFixed(2).replace('.', '');
    return 'corr_' + c.type + '_r' + rTag + '_n' + c.n;
  }

  // download the rendered 256x256 image as a PNG
  function exportPNG() {
    if (!state.data) return;
    var c = readControls();
    var name = stimulusName(c) + '.png';
    var a = document.createElement('a');
    a.href = renderExportCanvas(c).toDataURL('image/png');
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { a.parentNode && a.parentNode.removeChild(a); }, 200);
    $('exportNote').textContent = 'saved ' + name + ' (256×256) — pipe it through the PS pipeline, e.g.  cli/ps_stats ' + name;
  }

  // hand the rendered image to the PS web interface (same origin, no download).
  // The image is stashed in localStorage and the PS window is signalled (storage
  // event + BroadcastChannel); an already-open PS window reloads itself and
  // consumes it. A persistent reference to the PS window is kept so we FOCUS the
  // existing window rather than re-opening it (re-opening would reload it from
  // the sender side and race with the receiver).
  var psWin = null, psChannel = null;
  try { psChannel = new BroadcastChannel('ps_pipeline'); } catch (e) {}
  function sendToPS() {
    if (!state.data) return;
    var c = readControls();
    var payload = { dataURL: renderExportCanvas(c).toDataURL('image/png'),
                    src: stimulusName(c), ts: Date.now() };
    try {
      localStorage.setItem('ps_incoming', JSON.stringify(payload));
    } catch (e) {
      $('exportNote').textContent = 'Could not stash image (storage blocked): ' + e;
      return;
    }
    try { if (psChannel) psChannel.postMessage(payload); } catch (e) {}
    if (psWin && !psWin.closed) {
      try { psWin.focus(); } catch (e) {}           // already open: just focus, no reload
    } else {
      psWin = window.open('../web/index.html', 'ps_pipeline');
      if (psWin) { try { psWin.focus(); } catch (e) {} }
    }
    $('exportNote').textContent = 'Sent to the PS pipeline → analysis runs in the PS window.';
  }

  // read grayscale pixels (R+G+B)/3 from a canvas
  function grayPixelsFromCanvas(cv) {
    var ctx = cv.getContext('2d');
    var d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    var g = new Array(cv.width * cv.height);
    for (var i = 0, p = 0; i < g.length; i++, p += 4) g[i] = (d[p] + d[p + 1] + d[p + 2]) / 3;
    return g;
  }
  // draw a grayscale value array (0..255) into a canvas at 256x256
  function drawGrayArray(canvas, arr, nx, ny) {
    var off = document.createElement('canvas'); off.width = nx; off.height = ny;
    var octx = off.getContext('2d'); var id = octx.createImageData(nx, ny);
    for (var i = 0; i < nx * ny; i++) { var v = arr[i]; v = v < 0 ? 0 : v > 255 ? 255 : v; id.data[i*4]=id.data[i*4+1]=id.data[i*4+2]=v; id.data[i*4+3]=255; }
    octx.putImageData(id, 0, 0);
    var disp = 256; canvas.width = disp; canvas.height = disp;
    var ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, disp, disp); ctx.drawImage(off, 0, 0, disp, disp);
  }

  // send the rendered stimulus to the PS server and display the returned texture
  function serverSynthesize() {
    if (!state.data) return;
    var c = readControls();
    var url = ($('serverUrl').value || '').trim().replace(/\/+$/, '');
    var gray = grayPixelsFromCanvas(renderExportCanvas(c));
    $('serverNote').textContent = 'synthesizing on ' + url + ' …';
    var btn = $('serverSynth'); btn.disabled = true;
    var t0 = Date.now();
    fetch(url + '/synthesize', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nx: 256, ny: 256, image: gray,
        params: { N_steer: 4, N_pyr: 4, Na: 7, iterations: 50 } })
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error('HTTP ' + r.status + ' ' + t); });
      return r.json();
    }).then(function (out) {
      drawGrayArray($('serverCanvas'), out.image, out.nx, out.ny);
      $('serverNote').textContent = 'seed ' + out.seed + ' · analyze ' + out.analyzeMs +
        'ms · synth ' + out.synthMs + 'ms · round-trip ' + (Date.now() - t0) + 'ms';
    }).catch(function (e) {
      $('serverNote').textContent = 'server error: ' + e.message + '  (is the server running? CORS/URL ok?)';
    }).then(function () { btn.disabled = false; });
  }

  // wiring: r / n / seed regenerate; switching vis type only redraws (same data)
  $('corr').addEventListener('input', regenerate);
  $('npoints').addEventListener('change', regenerate);
  $('seed').addEventListener('change', regenerate);
  $('type').addEventListener('change', draw);
  $('marksize').addEventListener('input', draw);
  $('opacity').addEventListener('input', draw);
  $('regen').addEventListener('click', regenerate);
  $('export').addEventListener('click', exportPNG);
  $('sendps').addEventListener('click', sendToPS);
  $('serverSynth').addEventListener('click', serverSynthesize);
  window.addEventListener('resize', draw);

  // ===================== stimulus collection generation =====================
  // Build a list of plot "tasks". For each base level, `n` pairs: one plot at
  // exactly rbase, the other at r ~ Uniform[rbase-range, rbase+range] cropped to
  // [0,1]; left/right (which is the base) is randomized. Negative sign negates
  // both. Each plot becomes one CSV line; the two lines of a pair are adjacent.
  function buildTasks(cfg) {
    const tasks = []; let pair = 0;
    for (let bi = 0; bi < cfg.bases.length; bi++) {
      const rb = cfg.bases[bi];
      const lo = Math.max(0, rb - cfg.range), hi = Math.min(1, rb + cfg.range);
      for (let k = 0; k < cfg.n; k++) {
        pair++;
        const rOther = lo + Math.random() * (hi - lo);
        const rbaseV = cfg.sign * rb, rOtherV = cfg.sign * rOther;
        const baseLeft = Math.random() < 0.5;
        const lb = (pair - 1) * 2 + (baseLeft ? 0 : 1);
        const lo2 = (pair - 1) * 2 + (baseLeft ? 1 : 0);
        tasks[lb]  = { lineIndex: lb,  stim: pair, rbase: rbaseV, r: rbaseV,  lr: baseLeft ? 'L' : 'R' };
        tasks[lo2] = { lineIndex: lo2, stim: pair, rbase: rbaseV, r: rOtherV, lr: baseLeft ? 'R' : 'L' };
      }
    }
    return tasks;
  }
  // render a fresh dataset at correlation r to a 256x256 grayscale pixel array
  function renderGrayForR(r, c) {
    const data = CorrGen.generate(c.n, r, null);
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256;
    CorrRender.render(cv.getContext('2d'), data, {
      width: 256, height: 256, type: c.type, drawAxes: false, pad: 10,
      alpha: c.opacity, pointRadius: c.markSize, lineWidth: c.markSize });
    return grayPixelsFromCanvas(cv);
  }
  function fmtStat(v) { return isFinite(v) ? '' + (+v.toPrecision(7)) : '0'; }
  function fmtR(v) { return '' + (+v.toFixed(4)); }
  function visLabel(t) { return t === 'ordered' ? 'orderedlines' : t; }   // scatter | parallel | orderedlines
  function rowStr(t, raw, vis) {
    const a = new Array(5 + raw.length);
    a[0] = t.stim; a[1] = vis; a[2] = fmtR(t.rbase); a[3] = fmtR(t.r); a[4] = t.lr;
    for (let i = 0; i < raw.length; i++) a[5 + i] = fmtStat(raw[i]);
    return a.join(',');
  }
  function analyzeReq(url, gray, lean) {
    return fetch(url + '/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nx: 256, ny: 256, image: gray, params: { N_steer: 4, N_pyr: 4, Na: 7 }, lean: !!lean }) })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }

  var gen = { running: false, stop: false, recent: [], synthBusy: false, synthTimer: null };
  function pushRecent(t, gray) {
    gen.recent.push({ gray: Float32Array.from(gray), r: t.r, stim: t.stim, lr: t.lr });
    if (gen.recent.length > 24) gen.recent.shift();
  }
  function startSynthTimer(url) {
    gen.synthTimer = setInterval(function () {
      if (gen.synthBusy || !gen.recent.length) return;
      const pick = gen.recent[(Math.random() * gen.recent.length) | 0];
      // show the EXACT image that was sent immediately, then its synthesis
      drawGrayArray($('stimInput'), pick.gray, 256, 256);
      $('stimPreviewNote').textContent = 'stim ' + pick.stim + pick.lr + ' · r=' + pick.r.toFixed(3) + ' · synthesizing…';
      gen.synthBusy = true;
      fetch(url + '/synthesize', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nx: 256, ny: 256, image: Array.from(pick.gray), params: { N_iteration: 50 } }) })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (j && j.ok) { drawGrayArray($('stimPreview'), j.image, j.nx, j.ny);
            $('stimPreviewNote').textContent = 'stim ' + pick.stim + pick.lr + ' · r=' + pick.r.toFixed(3) + ' · seed ' + j.seed; }
        }).catch(function () {}).then(function () { gen.synthBusy = false; });
    }, 2000);
  }
  function stopSynthTimer() { if (gen.synthTimer) { clearInterval(gen.synthTimer); gen.synthTimer = null; } }

  async function startGeneration() {
    if (gen.running) return;
    const c = readControls();
    const url = ($('serverUrl').value || '').trim().replace(/\/+$/, '');
    const bases = ($('rbaseList').value || '').split(',').map(function (s) { return parseFloat(s.trim()); }).filter(function (x) { return isFinite(x); });
    const n = Math.max(1, parseInt($('nStimuli').value, 10) || 1);
    const range = Math.min(1, Math.max(0.1, parseFloat($('testRange').value) || 0.2));
    const signEl = document.querySelector('input[name=sign]:checked');
    const sign = (signEl && signEl.value === 'neg') ? -1 : 1;
    const K = Math.max(1, parseInt($('concurrency').value, 10) || 8);
    if (!bases.length) { $('genNote').textContent = 'enter at least one base correlation level'; return; }

    const tasks = buildTasks({ bases: bases, n: n, range: range, sign: sign });
    const total = tasks.length;
    const estMB = Math.round(total * 13000 / 1e6);
    if (estMB > 250 && !window.confirm('This will build ~' + estMB + ' MB of CSV in memory (' + total + ' rows). Continue?')) return;

    const rows = new Array(total);
    const vis = visLabel(c.type);
    let processed = 0, errors = 0;
    gen.running = true; gen.stop = false; gen.recent = [];
    $('genStart').disabled = true; $('genStop').disabled = false;
    const t0 = Date.now();

    function updateProgress() {
      const pct = Math.round(100 * processed / total);
      $('genBar').style.width = pct + '%';
      const el = (Date.now() - t0) / 1000, rate = processed / Math.max(el, 1e-6), eta = (total - processed) / Math.max(rate, 1e-6);
      $('genStatus').textContent = processed + ' / ' + total + ' plots (' + pct + '%) · ' +
        rate.toFixed(0) + ' plots/s · elapsed ' + el.toFixed(0) + 's · ETA ' + eta.toFixed(0) + 's' +
        (errors ? (' · ' + errors + ' errors') : '');
    }

    // probe the first task non-lean to capture the CSV header (stat names)
    let header;
    try {
      const g0 = renderGrayForR(tasks[0].r, c);
      const probe = await analyzeReq(url, g0, false);
      header = ['stimulus', 'vis', 'rbase', 'r', 'left_or_right'].concat(probe.stats.annotated.map(function (a) { return a.key; }));
      rows[tasks[0].lineIndex] = rowStr(tasks[0], probe.stats.raw, vis);
      processed = 1; pushRecent(tasks[0], g0);
    } catch (e) {
      $('genNote').textContent = 'cannot reach PS server at ' + url + ' (' + e.message + ') — is it running?';
      gen.running = false; $('genStart').disabled = false; $('genStop').disabled = true; return;
    }
    updateProgress();
    startSynthTimer(url);

    const rest = tasks.slice(1);
    let idx = 0;
    async function runner() {
      while (idx < rest.length && !gen.stop) {
        const t = rest[idx++];
        try {
          const g = renderGrayForR(t.r, c);
          const res = await analyzeReq(url, g, true);
          rows[t.lineIndex] = rowStr(t, res.raw, vis);
          if ((processed % 7) === 0) pushRecent(t, g);
        } catch (e) { errors++; }
        processed++;
        if ((processed % 25) === 0) updateProgress();
      }
    }
    const runners = []; for (let k = 0; k < K; k++) runners.push(runner());
    await Promise.all(runners);
    updateProgress(); stopSynthTimer();

    // assemble + download CSV (Blob from parts to avoid one giant string)
    const parts = [header.join(',') + '\n'];
    let written = 0;
    for (let i = 0; i < rows.length; i++) if (rows[i] !== undefined) { parts.push(rows[i] + '\n'); written++; }
    const blob = new Blob(parts, { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'stimuli_' + c.type + '_' + (sign < 0 ? 'neg' : 'pos') + '_' + bases.length + 'bases_' + n + 'x.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.parentNode && a.parentNode.removeChild(a); }, 1000);
    $('genNote').textContent = (gen.stop ? 'stopped — ' : 'done — ') + 'downloaded ' + a.download +
      ' (' + written + ' rows, ' + errors + ' errors)';
    gen.running = false; $('genStart').disabled = false; $('genStop').disabled = true;
  }

  $('genStart').addEventListener('click', startGeneration);
  $('genStop').addEventListener('click', function () { gen.stop = true; $('genStop').disabled = true; });

  regenerate();
})();
