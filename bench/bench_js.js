// JS benchmark (for jsc): times PS analysis() and synthesis() separately on the
// same fixture/params as the native harness. Single-threaded.
'use strict';
["fft","filters","mt19937","stats","linalg","pyramid","analysis","adjust","adjust_cross_scale","synthesis"]
  .forEach(function(m){ load("web/js/"+m+".js"); });

function parseFixture(t){ var nl=t.indexOf("\n"); var h=t.slice(0,nl).trim().split(/\s+/).map(Number);
  var b=t.slice(nl+1).trim().split(/\s+/); var N=h[0]*h[1]*h[2]; var img=new Float64Array(N);
  for(var i=0;i<N;i++) img[i]=parseFloat(b[i]); return {image:img,nx:h[0],ny:h[1],nz:h[2]}; }
function stat(t){ t.sort(function(a,b){return a-b;}); var mn=t[0], med=t[(t.length/2)|0];
  var s=0; for(var i=0;i<t.length;i++)s+=t[i]; return {min:mn,med:med,mean:s/t.length,n:t.length}; }
function pad(s,n){s=""+s;while(s.length<n)s=" "+s;return s;}
function report(name,t){var r=stat(t);
  print("  "+name+(new Array(13-name.length).join(" "))+" runs="+r.n+"  min="+pad(r.min.toFixed(2),8)+" ms  median="+pad(r.med.toFixed(2),8)+" ms  mean="+pad(r.mean.toFixed(2),8)+" ms"); return r;}

var R  = 7, Rs = 3;
var fx = parseFixture(readFile("test/fixture_gray.txt"));
var params = {N_steer:4,N_pyr:4,N_iteration:50,Na:7,noise:0,edge_handling:0,add_smooth:0,
              cmask:[1,1,1,1],verbose:0,interpWeight:-1,statistics:0};

print("JavaScript (jsc, Float64, single-threaded)  "+fx.nx+"x"+fx.ny+" nz="+fx.nz+
      "  P="+params.N_pyr+" K="+params.N_steer+" Na="+params.Na+" iters="+params.N_iteration);

// analysis (1 warmup + R timed)
var mt = new PS.MT(0);
var ta = [], stats;
for (var r=0; r<R+1; r++){ var t0=Date.now(); stats=PS.Analysis.analysis(fx, params, mt).stats; var dt=Date.now()-t0; if(r>0) ta.push(dt); }
report("analysis", ta);

// synthesis (1 warmup + Rs timed)
var ts = [];
for (var s=0; s<Rs+1; s++){
  var tex={image:new Float64Array(fx.nx*fx.ny), nx:fx.nx, ny:fx.ny, nz:1};
  var t1=Date.now(); PS.Synthesis.synthesis(tex, stats, params, new PS.MT(s+1)); var dt2=Date.now()-t1;
  if(s>0) ts.push(dt2);
}
var rs = report("synthesis", ts);
print("  (synth/iter) "+(rs.med/params.N_iteration).toFixed(2)+" ms/iteration");
