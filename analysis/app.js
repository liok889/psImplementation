// app.js — UI for the correlation-discrimination LDA. Wires the file pickers and
// options to the Web Worker, shows progress, and renders accuracy-vs-rbase.
'use strict';
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var trainFile = null, testFile = null, worker = null;

  var modeHints = {
    concat: 'Both plots’ full PS-statistic vectors are fed to the model ' +
      '(slot 0 stats followed by slot 1 stats). This is the requested configuration.',
    difference: 'Feeds slot0 − slot1 per statistic. Antisymmetric: swapping the two ' +
      'plots negates feature and label together, so left/right identity is impossible to encode. ' +
      'Half the dimensions, ~2× faster, essentially the same accuracy — the recommended safeguard.'
  };
  var covHints = {
    full: 'Models correlations between statistics (Cholesky solve). Much more accurate here, ' +
      'but O(d³): concat can take ~1–2 min.',
    diagonal: 'Treats statistics as independent. Near-instant, but lower accuracy because PS ' +
      'statistics are strongly correlated.'
  };

  function updateHints() {
    $('modeHint').textContent = modeHints[$('mode').value];
    $('covHint').textContent = covHints[$('covariance').value];
    var slow = ($('covariance').value === 'full' && $('mode').value === 'concat');
    $('timeNote').textContent = slow
      ? 'Full covariance on concatenated features can take ~1–2 minutes.'
      : ($('covariance').value === 'full' ? 'Full covariance may take ~20–40 s.' : '');
  }

  function refreshRunState() {
    $('run').disabled = !(trainFile && testFile);
  }

  $('trainFile').addEventListener('change', function (e) {
    trainFile = e.target.files[0] || null;
    var el = $('trainName');
    el.textContent = trainFile ? trainFile.name : 'no file selected';
    el.classList.toggle('set', !!trainFile);
    refreshRunState();
  });
  $('testFile').addEventListener('change', function (e) {
    testFile = e.target.files[0] || null;
    var el = $('testName');
    el.textContent = testFile ? testFile.name : 'no file selected';
    el.classList.toggle('set', !!testFile);
    refreshRunState();
  });
  $('mode').addEventListener('change', updateHints);
  $('covariance').addEventListener('change', updateHints);
  updateHints();

  function show(id, on) { $(id).classList.toggle('hidden', !on); }

  $('run').addEventListener('click', function () {
    if (!trainFile || !testFile) return;
    show('resultPanel', false);
    show('errorPanel', false);
    show('progressPanel', true);
    $('run').disabled = true;
    $('progBar').style.width = '0%';
    $('progMsg').textContent = 'starting…';

    if (worker) worker.terminate();
    worker = new Worker('worker.js');
    worker.onmessage = function (e) {
      var m = e.data;
      if (m.type === 'progress') {
        $('progBar').style.width = (100 * m.frac).toFixed(1) + '%';
        $('progMsg').textContent = m.msg || '';
      } else if (m.type === 'result') {
        show('progressPanel', false);
        $('run').disabled = false;
        renderResult(m.result);
      } else if (m.type === 'error') {
        show('progressPanel', false);
        $('run').disabled = false;
        show('errorPanel', true);
        $('errMsg').textContent = m.message;
      }
    };
    worker.onerror = function (err) {
      show('progressPanel', false);
      $('run').disabled = false;
      show('errorPanel', true);
      $('errMsg').textContent = err.message || 'worker error';
    };
    worker.postMessage({
      trainFile: trainFile, testFile: testFile,
      mode: $('mode').value, covariance: $('covariance').value,
      shrinkage: parseFloat($('shrinkage').value), seed: parseInt($('seed').value, 10) || 0
    });
  });

  function pct(x) { return (100 * x).toFixed(1) + '%'; }

  function downloadCSV(text, name) {
    var blob = new Blob([text], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.parentNode && a.parentNode.removeChild(a); }, 500);
  }

  var lastResult = null;
  $('dlTest').addEventListener('click', function () {
    if (lastResult) downloadCSV(lastResult.perStimulusTestCSV, 'per_stimulus_test_' + lastResult.mode + '.csv');
  });
  $('dlTrain').addEventListener('click', function () {
    if (lastResult) downloadCSV(lastResult.perStimulusTrainCSV, 'per_stimulus_train_' + lastResult.mode + '.csv');
  });

  function renderResult(r) {
    lastResult = r;
    show('resultPanel', true);

    // Headline metrics.
    $('metrics').innerHTML =
      metric('Test accuracy', pct(r.test.accuracy)) +
      metric('Train accuracy', pct(r.train.accuracy)) +
      metric('Test pairs', r.nTest + (r.nParticipantsTest > 1 ? ' · ' + r.nParticipantsTest + ' ppl' : '')) +
      metric('Features used', r.dKept + ' / ' + r.D);

    drawChart(r);

    // Per-rbase table.
    var levels = r.test.byRbase.map(function (x) { return x.rbase; });
    var trainByR = {}; r.train.byRbase.forEach(function (x) { trainByR[x.rbase] = x; });
    var rows = '<tr><th>rbase</th><th>test acc</th><th>test n</th><th>train acc</th></tr>';
    r.test.byRbase.forEach(function (x) {
      var tb = trainByR[x.rbase];
      rows += '<tr><td class="v">' + x.rbase.toFixed(2) + '</td>' +
        '<td class="v">' + pct(x.accuracy) + '</td>' +
        '<td class="v">' + x.n + '</td>' +
        '<td class="v">' + (tb ? pct(tb.accuracy) : '–') + '</td></tr>';
    });
    $('byRbaseTable').innerHTML = rows;

    // Per-participant test accuracy — shown only when the test set has >1 participant.
    var bp = r.test.byParticipant || [];
    if (bp.length > 1) {
      var trainByP = {}; (r.train.byParticipant || []).forEach(function (x) { trainByP[x.participant] = x; });
      var prows = '<tr><th>participant</th><th>test acc</th><th>test n</th><th>train acc</th></tr>';
      bp.forEach(function (x) {
        var tb = trainByP[x.participant];
        prows += '<tr><td class="v">' + x.participant + '</td>' +
          '<td class="v">' + pct(x.accuracy) + '</td>' +
          '<td class="v">' + x.n + '</td>' +
          '<td class="v">' + (tb ? pct(tb.accuracy) : '–') + '</td></tr>';
      });
      $('byParticipantTable').innerHTML = prows;
      show('byParticipantWrap', true);
    } else {
      show('byParticipantWrap', false);
    }

    $('modelSummary').textContent =
      'mode=' + r.mode + ' · covariance=' + r.covariance + ' · shrinkage=' + r.shrinkage +
      ' · seed=' + r.seed + ' · PS stats/plot=' + r.P +
      ' · participants train/test=' + r.nParticipantsTrain + '/' + r.nParticipantsTest +
      ' · train pairs=' + r.nTrain + ' (labels ' + r.balanceTrain.n1 + '/' + r.balanceTrain.n +
      ' = ' + r.balanceTrain.frac1.toFixed(3) + ' balanced)' +
      ' · train ' + (r.trainMs / 1000).toFixed(1) + 's · total ' + (r.totalMs / 1000).toFixed(1) + 's';
  }

  function metric(k, v) {
    return '<div class="metric"><div class="k">' + k + '</div><div class="val">' + v + '</div></div>';
  }

  // Inline-SVG line chart: accuracy (y) vs rbase (x), test + train + chance line.
  function drawChart(r) {
    var W = 640, H = 340, mL = 48, mR = 18, mT = 16, mB = 42;
    var plotW = W - mL - mR, plotH = H - mT - mB;
    var levels = r.test.byRbase.map(function (x) { return x.rbase; });
    var xmin = Math.min.apply(null, levels), xmax = Math.max.apply(null, levels);
    if (xmin === xmax) { xmin -= 0.1; xmax += 0.1; }
    var ymin = 0.4, ymax = 1.0;

    function X(v) { return mL + (xmax === xmin ? plotW / 2 : (v - xmin) / (xmax - xmin) * plotW); }
    function Y(v) { return mT + (1 - (v - ymin) / (ymax - ymin)) * plotH; }

    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="max-width:' + W + 'px">';
    // Y gridlines / ticks every 0.1.
    for (var yv = ymin; yv <= ymax + 1e-9; yv += 0.1) {
      var yy = Y(yv);
      svg += '<line x1="' + mL + '" y1="' + yy + '" x2="' + (W - mR) + '" y2="' + yy +
        '" stroke="#2a2f3d" stroke-width="1"/>';
      svg += '<text x="' + (mL - 8) + '" y="' + (yy + 3) + '" text-anchor="end">' + Math.round(yv * 100) + '%</text>';
    }
    // Chance line at 0.5.
    var y50 = Y(0.5);
    svg += '<line x1="' + mL + '" y1="' + y50 + '" x2="' + (W - mR) + '" y2="' + y50 +
      '" stroke="var(--chance)" stroke-width="1.5" stroke-dasharray="5 4"/>';
    // X ticks.
    levels.forEach(function (v) {
      svg += '<text x="' + X(v) + '" y="' + (H - mB + 18) + '" text-anchor="middle">' + v.toFixed(2) + '</text>';
    });
    svg += '<text x="' + (mL + plotW / 2) + '" y="' + (H - 4) + '" text-anchor="middle">rbase (base correlation)</text>';

    svg += series(r.train.byRbase, 'var(--train)', X, Y);
    svg += series(r.test.byRbase, 'var(--test)', X, Y);
    svg += '</svg>';
    $('chart').innerHTML = svg;
  }

  function series(arr, color, X, Y) {
    var pts = arr.map(function (x) { return X(x.rbase) + ',' + Y(x.accuracy); }).join(' ');
    var s = '<polyline points="' + pts + '" fill="none" stroke="' + color + '" stroke-width="2.5"/>';
    arr.forEach(function (x) {
      s += '<circle cx="' + X(x.rbase) + '" cy="' + Y(x.accuracy) + '" r="3.5" fill="' + color + '"/>';
    });
    return s;
  }
})();
