// Canvas renderer for the two visualization types. A single routine is used for
// both the on-screen display and the 256x256 PNG export so the exported image
// matches what is shown. D3 linear scales map data to pixels; drawing is done on
// a 2D canvas (which makes exact-size raster export, for the PS pipeline,
// trivial). Marks are dark on a white background so the grayscale PS analysis
// sees the data as texture.
(function (root) {
  'use strict';

  function extent(data, k) {
    var lo = Infinity, hi = -Infinity;
    for (var i = 0; i < data.length; i++) { var v = data[i][k]; if (v < lo) lo = v; if (v > hi) hi = v; }
    if (lo === hi) { lo -= 1; hi += 1; }
    return [lo, hi];
  }

  // render(ctx, data, opts)
  //   opts: { width, height, type:'scatter'|'parallel', pad, pointRadius,
  //           lineWidth, drawAxes, ink }
  function render(ctx, data, opts) {
    var w = opts.width, h = opts.height;
    var pad = opts.pad != null ? opts.pad : Math.round(Math.min(w, h) * 0.08);
    var ink = opts.ink || "#000";
    var axisCol = "#c7ccd6";

    ctx.save();
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);

    var ex = extent(data, 0), ey = extent(data, 1);

    if (opts.type === "parallel") {
      var xL = pad, xR = w - pad;
      var yL = d3.scaleLinear().domain(ex).range([h - pad, pad]);
      var yR = d3.scaleLinear().domain(ey).range([h - pad, pad]);
      if (opts.drawAxes) {
        ctx.strokeStyle = axisCol; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(xL, pad); ctx.lineTo(xL, h - pad);
        ctx.moveTo(xR, pad); ctx.lineTo(xR, h - pad); ctx.stroke();
      }
      ctx.strokeStyle = ink;
      ctx.lineWidth = opts.lineWidth != null ? opts.lineWidth : Math.max(0.5, w / 320);
      ctx.globalAlpha = opts.alpha != null ? opts.alpha : 1;
      ctx.beginPath();
      for (var i = 0; i < data.length; i++) {
        ctx.moveTo(xL, yL(data[i][0]));
        ctx.lineTo(xR, yR(data[i][1]));
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else { // scatterplot
      var sx = d3.scaleLinear().domain(ex).range([pad, w - pad]);
      var sy = d3.scaleLinear().domain(ey).range([h - pad, pad]);
      if (opts.drawAxes) {
        ctx.strokeStyle = axisCol; ctx.lineWidth = 1;
        ctx.strokeRect(pad - 0.5, pad - 0.5, w - 2 * pad + 1, h - 2 * pad + 1);
      }
      var rad = opts.pointRadius != null ? opts.pointRadius : Math.max(1, w / 130);
      ctx.fillStyle = ink;
      ctx.globalAlpha = opts.alpha != null ? opts.alpha : 1;
      for (var j = 0; j < data.length; j++) {
        ctx.beginPath();
        ctx.arc(sx(data[j][0]), sy(data[j][1]), rad, 0, 2 * Math.PI);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  root.CorrRender = { render: render };
})(typeof globalThis !== 'undefined' ? globalThis : this);
