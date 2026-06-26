/* Native benchmark harness: times the GENUINE reference analysis() and
 * synthesis() separately, on the same numeric fixture the JS uses, linked
 * against the real (installed) FFTW. Single-threaded (analysis()/synthesis()
 * never call fftwf_plan_with_nthreads, so FFTW runs serially) for a fair
 * core-algorithm comparison against the single-threaded JS engine. */
#include <cstdio>
#include <cstdlib>
#include <vector>
#include <algorithm>
#include <chrono>

#include "ps_lib.h"
#include "analysis.h"
#include "constraints.h"
#include "synthesis.h"
#include "mt19937ar.h"

using clk = std::chrono::high_resolution_clock;
static double ms(clk::time_point a, clk::time_point b) {
  return std::chrono::duration<double, std::milli>(b - a).count();
}
static void report(const char *name, std::vector<double> &t) {
  std::sort(t.begin(), t.end());
  double med = t[t.size() / 2], mn = t.front();
  double sum = 0; for (double v : t) sum += v; double mean = sum / t.size();
  printf("  %-12s runs=%zu  min=%8.2f ms  median=%8.2f ms  mean=%8.2f ms\n",
         name, t.size(), mn, med, mean);
}

int main(int argc, char **argv) {
  const char *infile = argc > 1 ? argv[1] : "test/fixture_gray.txt";
  int R = argc > 2 ? atoi(argv[2]) : 7;       // analysis repetitions
  int Rs = argc > 3 ? atoi(argv[3]) : 5;      // synthesis repetitions

  FILE *fin = fopen(infile, "r");
  if (!fin) { fprintf(stderr, "cannot open %s\n", infile); return 1; }
  int nx, ny, nz;
  if (fscanf(fin, "%d %d %d", &nx, &ny, &nz) != 3) return 1;
  int N = nx * ny * nz;
  std::vector<float> pix0(N);
  for (int i = 0; i < N; i++) if (fscanf(fin, "%f", &pix0[i]) != 1) return 1;
  fclose(fin);

  paramsStruct params;
  params.N_steer = 4; params.N_pyr = 4; params.N_iteration = 50; params.Na = 7;
  params.noise = 0; params.edge_handling = 0; params.add_smooth = 0;
  params.cmask[0] = params.cmask[1] = params.cmask[2] = params.cmask[3] = 1;
  params.verbose = 0; params.interpWeight = -1; params.statistics = 0;

  printf("native C++ (real FFTW, single-threaded)  %dx%d nz=%d  P=%d K=%d Na=%d iters=%d\n",
         nx, ny, nz, params.N_pyr, params.N_steer, params.Na, params.N_iteration);

  mt_init_genrand(0);
  std::vector<float> work(N);

  // ---- analysis ----
  std::vector<double> ta;
  for (int r = 0; r < R + 1; r++) {           // +1 warmup (discarded)
    work = pix0;
    imageStruct sample; sample.image = work.data(); sample.nx = nx; sample.ny = ny; sample.nz = nz;
    statsStruct stats; allocate_stats(&stats, params, nz);
    auto a = clk::now();
    analysis(&stats, sample, params);
    auto b = clk::now();
    if (r > 0) ta.push_back(ms(a, b));
    free_stats(stats, params, nz);
  }
  report("analysis", ta);

  // statistics for synthesis (one clean analysis)
  work = pix0;
  imageStruct sample; sample.image = work.data(); sample.nx = nx; sample.ny = ny; sample.nz = nz;
  statsStruct stats; allocate_stats(&stats, params, nz);
  analysis(&stats, sample, params);

  // ---- synthesis ----
  std::vector<double> ts;
  std::vector<float> tex(nx * ny * nz);
  for (int r = 0; r < Rs + 1; r++) {          // +1 warmup
    imageStruct texture; texture.image = tex.data(); texture.nx = nx; texture.ny = ny; texture.nz = nz;
    auto a = clk::now();
    synthesis(texture, stats, params);
    auto b = clk::now();
    if (r > 0) ts.push_back(ms(a, b));
  }
  report("synthesis", ts);
  printf("  %-12s %.2f ms/iteration\n", "(synth/iter)", ts[ts.size()/2] / params.N_iteration);

  free_stats(stats, params, nz);
  return 0;
}
