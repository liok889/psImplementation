// Headless rasterizer (for jsc): generate a bivariate dataset at a set sample
// correlation and rasterize it to a size×size grayscale "fixture" (the same
// nx ny nz + floats format the PS tools read), printed to stdout. This is the
// batch / scriptable counterpart of the browser PNG export. The rasterization
// (CorrRaster) mirrors the canvas renderer's marks (dark on white) but is
// hard-edged, not a pixel-exact copy of the browser canvas.
//
//   jsc corr_to_fixture.js -- <root> <n> <r> <type> [seed] [size] [markSize] [opacity]
'use strict';
var a = (typeof arguments !== 'undefined') ? Array.prototype.slice.call(arguments) : [];
if (a.length < 4) { print("usage: jsc corr_to_fixture.js -- <root> <n> <r> <scatter|parallel|ordered> [seed] [size] [markSize] [opacity]"); if (typeof quit === 'function') quit(2); }
var ROOT = a[0], n = parseInt(a[1], 10), r = parseFloat(a[2]), type = a[3];
var seed = (a[4] === undefined || a[4] === "") ? null : (parseInt(a[4], 10) >>> 0);
var size = a[5] ? parseInt(a[5], 10) : 256;
var markSize = a[6] ? parseFloat(a[6]) : 2;          // circle radius / line width (px)
var opacity = a[7] ? parseFloat(a[7]) : 1;           // 1 = fully opaque (default)

load(ROOT + "/correlation_percepts/lib/d3.v7.min.js");
load(ROOT + "/correlation_percepts/js/gen.js");
load(ROOT + "/correlation_percepts/js/raster.js");

var pts = CorrGen.generate(n, r, seed);
var img = CorrRaster.rasterize(pts, { size: size, type: type, markSize: markSize, opacity: opacity, pad: 10 });

// emit fixture: "nx ny nz" then size*size floats (row-major i + j*nx)
var out = size + " " + size + " 1\n";
var parts = new Array(img.length);
for (var i = 0; i < img.length; i++) parts[i] = img[i].toFixed(3);
out += parts.join(' ') + "\n";
print(out);
