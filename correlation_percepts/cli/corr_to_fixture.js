// Headless rasterizer (for jsc): generate a bivariate dataset at a set sample
// correlation and rasterize it to a 256x256 grayscale "fixture" (the same
// nx ny nz + floats format the PS tools read), printed to stdout. This is the
// batch / scriptable counterpart of the browser PNG export, so many correlation
// stimuli can be fed through the PS pipeline. It mirrors the canvas renderer's
// marks (dark on white); it is a rasterization approximation, not a pixel-exact
// copy of the browser canvas.
//
//   jsc corr_to_fixture.js -- <root> <n> <r> <type> [seed] [size] [markSize] [opacity]
'use strict';
var a = (typeof arguments !== 'undefined') ? Array.prototype.slice.call(arguments) : [];
if (a.length < 4) { print("usage: jsc corr_to_fixture.js -- <root> <n> <r> <scatter|parallel> [seed] [size] [markSize] [opacity]"); if (typeof quit === 'function') quit(2); }
var ROOT = a[0], n = parseInt(a[1], 10), r = parseFloat(a[2]), type = a[3];
var seed = (a[4] === undefined || a[4] === "") ? null : (parseInt(a[4], 10) >>> 0);
var size = a[5] ? parseInt(a[5], 10) : 256;
var markSize = a[6] ? parseFloat(a[6]) : 2;          // circle radius / line width (px)
var opacity = a[7] ? parseFloat(a[7]) : 1;           // 1 = fully opaque (default)

load(ROOT + "/correlation_percepts/lib/d3.v7.min.js");
load(ROOT + "/correlation_percepts/js/gen.js");

var pts = CorrGen.generate(n, r, seed);
function extent(d, k) { var lo = Infinity, hi = -Infinity; for (var i = 0; i < d.length; i++) { var v = d[i][k]; if (v < lo) lo = v; if (v > hi) hi = v; } if (lo === hi) { lo -= 1; hi += 1; } return [lo, hi]; }

var img = new Float64Array(size * size); for (var i = 0; i < img.length; i++) img[i] = 255;
var pad = 10, ink = 0;   // black marks
function blend(px, py, alpha) {
  if (px < 0 || px >= size || py < 0 || py >= size) return;
  var idx = px + py * size;
  img[idx] = img[idx] * (1 - alpha) + ink * alpha;
}
var ex = extent(pts, 0), ey = extent(pts, 1);
function mapx(v) { return pad + (v - ex[0]) / (ex[1] - ex[0]) * (size - 2 * pad); }
function mapyL(v) { return (size - pad) - (v - ex[0]) / (ex[1] - ex[0]) * (size - 2 * pad); }
function mapy(v) { return (size - pad) - (v - ey[0]) / (ey[1] - ey[0]) * (size - 2 * pad); }
function mapyR(v) { return (size - pad) - (v - ey[0]) / (ey[1] - ey[0]) * (size - 2 * pad); }

if (type === 'parallel') {
  // no horizontal padding: lines span edge to edge (avoids margin artifacts)
  var xL = 0, xR = size - 1;
  var hw = Math.max(0, Math.round(markSize / 2));   // half line-thickness
  for (i = 0; i < pts.length; i++) {
    var y0 = mapyL(pts[i][0]), y1 = mapyR(pts[i][1]);
    var steps = Math.max(1, Math.round(xR - xL));
    for (var s = 0; s <= steps; s++) {
      var t = s / steps;
      var px = Math.round(xL + t * (xR - xL));
      var py = Math.round(y0 + t * (y1 - y0));
      for (var ty = -hw; ty <= hw; ty++) for (var tx = -hw; tx <= hw; tx++)
        blend(px + tx, py + ty, opacity);
    }
  }
} else if (type === 'ordered') {
  // sort by x; draw two black polylines (sorted-x series and y-in-that-order)
  var hwo = Math.max(0, Math.round(markSize / 2));
  var n2 = pts.length;
  var order = []; for (var q = 0; q < n2; q++) order.push(q);
  order.sort(function (a, b) { return pts[a][0] - pts[b][0]; });
  var xposO = function (i) { return n2 > 1 ? (i / (n2 - 1)) * (size - 1) : (size - 1) / 2; };
  var mapV = function (v, e) { return (size - pad) - (v - e[0]) / (e[1] - e[0]) * (size - 2 * pad); };
  var segO = function (x0, y0, x1, y1) {
    var steps = Math.max(1, Math.round(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
    for (var s = 0; s <= steps; s++) {
      var t = s / steps, px = Math.round(x0 + t * (x1 - x0)), py = Math.round(y0 + t * (y1 - y0));
      for (var ty = -hwo; ty <= hwo; ty++) for (var tx = -hwo; tx <= hwo; tx++) blend(px + tx, py + ty, opacity);
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

// emit fixture: "nx ny nz" then size*size floats (row-major i + j*nx)
var out = size + " " + size + " 1\n";
var parts = new Array(img.length);
for (i = 0; i < img.length; i++) parts[i] = img[i].toFixed(3);
out += parts.join(' ') + "\n";
print(out);
