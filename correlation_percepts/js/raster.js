// CorrRaster — pure-JS rasterizer for correlation stimuli, the headless
// counterpart of the browser's canvas renderer (js/render.js). It draws the same
// marks (dark on white) as hard-edged pixels — NOT antialiased like the canvas —
// so it is deterministic and dependency-free (runs under `jsc`), at the cost of
// not being a pixel-exact copy of the browser canvas. Used by the CLI generator
// and by cli/corr_to_fixture.js. UMD-style global `CorrRaster`.
(function (root) {
  'use strict';

  function extent(d, k) {
    var lo = Infinity, hi = -Infinity;
    for (var i = 0; i < d.length; i++) { var v = d[i][k]; if (v < lo) lo = v; if (v > hi) hi = v; }
    if (lo === hi) { lo -= 1; hi += 1; }
    return [lo, hi];
  }

  // Rasterize points to a size×size grayscale Float64Array (row-major
  // idx = x + y*size), background 255, ink 0. opts:
  //   { size=256, type:'scatter'|'parallel'|'ordered', markSize=2, opacity=1, pad=10 }
  function rasterize(pts, opts) {
    opts = opts || {};
    var size = opts.size || 256;
    var type = opts.type || 'scatter';
    var markSize = opts.markSize != null ? opts.markSize : 2;
    var opacity = opts.opacity != null ? opts.opacity : 1;
    var pad = opts.pad != null ? opts.pad : 10;
    var ink = 0;

    var img = new Float64Array(size * size);
    for (var i0 = 0; i0 < img.length; i0++) img[i0] = 255;
    function blend(px, py, alpha) {
      if (px < 0 || px >= size || py < 0 || py >= size) return;
      var idx = px + py * size;
      img[idx] = img[idx] * (1 - alpha) + ink * alpha;
    }

    var ex = extent(pts, 0), ey = extent(pts, 1);
    function mapx(v) { return pad + (v - ex[0]) / (ex[1] - ex[0]) * (size - 2 * pad); }
    function mapy(v) { return (size - pad) - (v - ey[0]) / (ey[1] - ey[0]) * (size - 2 * pad); }
    function mapyL(v) { return (size - pad) - (v - ex[0]) / (ex[1] - ex[0]) * (size - 2 * pad); }
    function mapyR(v) { return (size - pad) - (v - ey[0]) / (ey[1] - ey[0]) * (size - 2 * pad); }

    var i, s, t, px, py, tx, ty;
    if (type === 'parallel') {
      // no horizontal padding: lines span edge to edge (avoids margin artifacts)
      var xL = 0, xR = size - 1;
      var hw = Math.max(0, Math.round(markSize / 2));   // half line-thickness
      for (i = 0; i < pts.length; i++) {
        var y0 = mapyL(pts[i][0]), y1 = mapyR(pts[i][1]);
        var steps = Math.max(1, Math.round(xR - xL));
        for (s = 0; s <= steps; s++) {
          t = s / steps;
          px = Math.round(xL + t * (xR - xL));
          py = Math.round(y0 + t * (y1 - y0));
          for (ty = -hw; ty <= hw; ty++) for (tx = -hw; tx <= hw; tx++) blend(px + tx, py + ty, opacity);
        }
      }
    } else if (type === 'ordered') {
      // sort by x; draw two black polylines (sorted-x series and y-in-that-order)
      var hwo = Math.max(0, Math.round(markSize / 2));
      var n2 = pts.length;
      var order = []; for (var q = 0; q < n2; q++) order.push(q);
      order.sort(function (a, b) { return pts[a][0] - pts[b][0]; });
      var xposO = function (ii) { return n2 > 1 ? (ii / (n2 - 1)) * (size - 1) : (size - 1) / 2; };
      var mapV = function (v, e) { return (size - pad) - (v - e[0]) / (e[1] - e[0]) * (size - 2 * pad); };
      var segO = function (x0, yy0, x1, yy1) {
        var st = Math.max(1, Math.round(Math.max(Math.abs(x1 - x0), Math.abs(yy1 - yy0))));
        for (var ss = 0; ss <= st; ss++) {
          var tt = ss / st, ppx = Math.round(x0 + tt * (x1 - x0)), ppy = Math.round(yy0 + tt * (yy1 - yy0));
          for (var qy = -hwo; qy <= hwo; qy++) for (var qx = -hwo; qx <= hwo; qx++) blend(ppx + qx, ppy + qy, opacity);
        }
      };
      for (i = 1; i < n2; i++) segO(xposO(i - 1), mapV(pts[order[i - 1]][0], ex), xposO(i), mapV(pts[order[i]][0], ex));
      for (i = 1; i < n2; i++) segO(xposO(i - 1), mapV(pts[order[i - 1]][1], ey), xposO(i), mapV(pts[order[i]][1], ey));
    } else { // scatter
      var rad = Math.max(0, Math.round(markSize));
      for (i = 0; i < pts.length; i++) {
        var cx = Math.round(mapx(pts[i][0])), cy = Math.round(mapy(pts[i][1]));
        for (var dy = -rad; dy <= rad; dy++) for (var dx = -rad; dx <= rad; dx++)
          if (dx * dx + dy * dy <= rad * rad) blend(cx + dx, cy + dy, opacity);
      }
    }
    return img;
  }

  var api = { rasterize: rasterize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CorrRaster = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
