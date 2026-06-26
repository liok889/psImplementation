// Headless rasterizer (for jsc): generate a bivariate dataset at a set sample
// correlation and rasterize it to a 256x256 grayscale "fixture" (the same
// nx ny nz + floats format the PS tools read), printed to stdout. This is the
// batch / scriptable counterpart of the browser PNG export, so many correlation
// stimuli can be fed through the PS pipeline. It mirrors the canvas renderer's
// marks (dark on white); it is a rasterization approximation, not a pixel-exact
// copy of the browser canvas.
//
//   jsc corr_to_fixture.js -- <root> <n> <r> <type> [seed] [size]
'use strict';
var a = (typeof arguments !== 'undefined') ? Array.prototype.slice.call(arguments) : [];
if (a.length < 4) { print("usage: jsc corr_to_fixture.js -- <root> <n> <r> <scatter|parallel> [seed] [size]"); if (typeof quit === 'function') quit(2); }
var ROOT = a[0], n = parseInt(a[1], 10), r = parseFloat(a[2]), type = a[3];
var seed = (a[4] === undefined || a[4] === "") ? null : (parseInt(a[4], 10) >>> 0);
var size = a[5] ? parseInt(a[5], 10) : 256;

load(ROOT + "/correlation_percepts/lib/d3.v7.min.js");
load(ROOT + "/correlation_percepts/js/gen.js");

var pts = CorrGen.generate(n, r, seed);
function extent(d, k) { var lo = Infinity, hi = -Infinity; for (var i = 0; i < d.length; i++) { var v = d[i][k]; if (v < lo) lo = v; if (v > hi) hi = v; } if (lo === hi) { lo -= 1; hi += 1; } return [lo, hi]; }

var img = new Float64Array(size * size); for (var i = 0; i < img.length; i++) img[i] = 255;
var pad = 10, ink = 17;
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
  var xL = pad, xR = size - pad, alpha = 0.5;
  for (i = 0; i < pts.length; i++) {
    var y0 = mapyL(pts[i][0]), y1 = mapyR(pts[i][1]);
    // Bresenham-ish line from (xL,y0) to (xR,y1)
    var steps = Math.max(1, Math.round(xR - xL));
    for (var s = 0; s <= steps; s++) {
      var t = s / steps;
      var px = Math.round(xL + t * (xR - xL));
      var py = Math.round(y0 + t * (y1 - y0));
      blend(px, py, alpha);
    }
  }
} else { // scatter
  var rad = Math.max(1, Math.round(size / 130)), alpha2 = 0.65;
  for (i = 0; i < pts.length; i++) {
    var cx = Math.round(mapx(pts[i][0])), cy = Math.round(mapy(pts[i][1]));
    for (var dy = -rad; dy <= rad; dy++) for (var dx = -rad; dx <= rad; dx++)
      if (dx * dx + dy * dy <= rad * rad) blend(cx + dx, cy + dy, alpha2);
  }
}

// emit fixture: "nx ny nz" then size*size floats (row-major i + j*nx)
var out = size + " " + size + " 1\n";
var parts = new Array(img.length);
for (i = 0; i < img.length; i++) parts[i] = img[i].toFixed(3);
out += parts.join(' ') + "\n";
print(out);
