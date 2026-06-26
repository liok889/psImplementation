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

  regenerate();
})();
