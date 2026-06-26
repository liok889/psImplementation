// Verify the reference C++ "-S" CSV output matches the JS raw statistics export,
// value-by-value and in the same order. For jsc:
//   jsc test/verify_cpp_csv.js            (reads test/cpp_stats.csv)
'use strict';
["fft","filters","mt19937","stats","linalg","pyramid","analysis","adjust","adjust_cross_scale","synthesis","statsjson"]
  .forEach(function(m){ load("web/js/"+m+".js"); });

function parseFixture(t){ var nl=t.indexOf("\n"); var h=t.slice(0,nl).trim().split(/\s+/).map(Number);
  var b=t.slice(nl+1).trim().split(/\s+/); var N=h[0]*h[1]*h[2]; var im=new Float64Array(N);
  for(var i=0;i<N;i++) im[i]=parseFloat(b[i]); return {image:im,nx:h[0],ny:h[1],nz:h[2]}; }

var fx = parseFixture(readFile("test/fixture_gray.txt"));
var params = {N_steer:4,N_pyr:4,N_iteration:50,Na:7,noise:0,edge_handling:0,add_smooth:0,
              cmask:[1,1,1,1],verbose:0,interpWeight:-1,statistics:0};

// JS side: analysis -> raw statistics array (the synthesis-relevant set, JS order)
var stats = PS.Analysis.analysis(fx, params, new PS.MT(0)).stats;
var obj = PS.StatsJSON.statsToObject(stats, params, {nx:fx.nx, ny:fx.ny}, "js");
var jsRaw = obj.raw, ann = obj.annotated;

// C++ side: the CSV line produced by `portilla_simoncelli ... -S 1`
var cppRaw = readFile("test/cpp_stats.csv").trim().split(',').map(Number);

print("JS values: " + jsRaw.length + "   C++ values: " + cppRaw.length);
if (jsRaw.length !== cppRaw.length) { print("LENGTH MISMATCH"); if (typeof quit==='function') quit(1); }

// per-group aggregation
var groups = {};
var worst = { rel: 0, i: -1 };
for (var i = 0; i < jsRaw.length; i++) {
  var g = ann[i].group;
  var G = groups[g] || (groups[g] = { n:0, maxAbs:0, scale:0 });
  G.n++; G.scale = Math.max(G.scale, Math.abs(jsRaw[i]));
  var abs = Math.abs(jsRaw[i] - cppRaw[i]);
  if (abs > G.maxAbs) G.maxAbs = abs;
}
// second pass for group-relative + worst single index
for (var k in groups) groups[k].rel = groups[k].maxAbs / (groups[k].scale > 1e-9 ? groups[k].scale : 1);
for (i = 0; i < jsRaw.length; i++) {
  var sc = groups[ann[i].group].scale || 1;
  var rel = Math.abs(jsRaw[i] - cppRaw[i]) / (sc > 1e-9 ? sc : 1);
  if (rel > worst.rel) { worst.rel = rel; worst.i = i; }
}

function pad(s,n){s=""+s;while(s.length<n)s+=" ";return s;} function padl(s,n){s=""+s;while(s.length<n)s=" "+s;return s;}
print("");
print(pad("group",16)+padl("count",7)+padl("scale",13)+padl("maxAbsErr",14)+padl("maxRelErr",13));
print(new Array(64).join("-"));
var order=["pixelMarginal","lowbandMarginal","highpassVariance","magnitudeMean","autoCorrelation","crossCorrelation"];
var allPass = true;
order.forEach(function(g){ if(!groups[g]) return; var G=groups[g];
  var pass = G.rel < 2e-3 || G.maxAbs < 1e-4; allPass = allPass && pass;
  print(pad(g,16)+padl(G.n,7)+padl(G.scale.toPrecision(5),13)+padl(G.maxAbs.toExponential(3),14)+padl(G.rel.toExponential(3),13));
});
print(new Array(64).join("-"));
var w = ann[worst.i];
print("worst element: index "+worst.i+"  ("+w.key+")  js="+jsRaw[worst.i].toPrecision(7)+"  cpp="+cppRaw[worst.i].toPrecision(7)+"  relErr="+worst.rel.toExponential(3));
print(allPass ? "PASS - C++ -S output matches JS raw export (order + values)" : "FAIL");
if (typeof quit==='function') quit(allPass?0:1);
