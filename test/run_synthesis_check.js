// Synthesis self-consistency check (for jsc): synthesize a texture from the
// statistics extracted from the fixture, then RE-ANALYZE the synthesized texture
// and report how closely its statistics match the targets. This demonstrates the
// JS synthesis correctly imposes the parametric model. (It is not a bit-match to
// the C++ reference: the noise seed and FFT precision differ.)
'use strict';
["fft","filters","mt19937","stats","linalg","pyramid","analysis","adjust","adjust_cross_scale","synthesis"]
  .forEach(function(m){ load("web/js/"+m+".js"); });

function parseFixture(text){
  var nl=text.indexOf("\n"); var h=text.slice(0,nl).trim().split(/\s+/).map(Number);
  var b=text.slice(nl+1).trim().split(/\s+/); var N=h[0]*h[1]*h[2]; var img=new Float64Array(N);
  for(var i=0;i<N;i++) img[i]=parseFloat(b[i]);
  return {image:img,nx:h[0],ny:h[1],nz:h[2]};
}

var ITERS = 50;
var fx = parseFixture(readFile("test/fixture_gray.txt"));
var params = {N_steer:4,N_pyr:4,N_iteration:ITERS,Na:7,noise:0,edge_handling:0,add_smooth:0,
              cmask:[1,1,1,1],verbose:0,interpWeight:-1,statistics:0};

var mt = new PS.MT(0);
var target = PS.Analysis.analysis(fx, params, mt).stats;

var nx=fx.nx, ny=fx.ny;
var tex = {image:new Float64Array(nx*ny), nx:nx, ny:ny, nz:1};
var t0 = Date.now();
PS.Synthesis.synthesis(tex, target, params, new PS.MT(12345));
print("synthesized "+ITERS+" iterations in "+(Date.now()-t0)+" ms");

// re-analyze the synthesized texture
var got = PS.Analysis.analysis({image:new Float64Array(tex.image),nx:nx,ny:ny,nz:1}, params, new PS.MT(0)).stats;

function flat(x){ if(x.length===undefined) return [x]; var o=[]; for(var i=0;i<x.length;i++){var e=x[i]; if(e&&e.length!==undefined)for(var j=0;j<e.length;j++)o.push(e[j]); else o.push(e);} return o; }
function cmp(name, a, b){
  var A=flat(a), B=flat(b), n=Math.min(A.length,B.length), scale=0, e=0;
  for(var i=0;i<n;i++) scale=Math.max(scale,Math.abs(B[i]));
  for(i=0;i<n;i++) e=Math.max(e, Math.abs(A[i]-B[i]));
  return {name:name, rel:e/(scale>1e-9?scale:1), scale:scale};
}
function pad(s,n){s=""+s;while(s.length<n)s+=" ";return s;} function padl(s,n){s=""+s;while(s.length<n)s=" "+s;return s;}

var groups=[["pixelStats",got.pixelStats,target.pixelStats],
            ["skewLow",got.skewLow,target.skewLow],["kurtLow",got.kurtLow,target.kurtLow],
            ["varHigh",got.varHigh,target.varHigh],["magMeans",got.magMeans,target.magMeans],
            ["autoCorLow",got.autoCorLow,target.autoCorLow],["autoCorMag",got.autoCorMag,target.autoCorMag],
            ["cousinMagCor",got.cousinMagCor,target.cousinMagCor],
            ["parentMagCor",got.parentMagCor,target.parentMagCor],
            ["parentRealCor",got.parentRealCor.slice(0,params.N_pyr-1),target.parentRealCor.slice(0,params.N_pyr-1)]];

print("");
print("Synthesis convergence: achieved statistics vs target (group-relative max error)");
print(pad("group",16)+padl("scale",13)+padl("maxRelErr",13));
print(new Array(44).join("-"));
for(var g=0; g<groups.length; g++){
  var r=cmp(groups[g][0],groups[g][1],groups[g][2]);
  print(pad(r.name,16)+padl(r.scale.toPrecision(5),13)+padl((r.rel*100).toFixed(2)+"%",13));
}
// pixel stats are imposed last and should match tightly
var pe=cmp("pixelStats",got.pixelStats,target.pixelStats).rel;
print(new Array(44).join("-"));
print(pe < 0.02 ? "PIXEL STATISTICS CONVERGED (<2%)" : "pixel stats rel err = "+(pe*100).toFixed(2)+"%");
