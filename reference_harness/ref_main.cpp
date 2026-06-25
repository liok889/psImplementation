/* Reference statistics harness.
 *
 * Reads the shared numeric fixture (test/fixture_gray.txt), runs the GENUINE
 * Portilla-Simoncelli reference analysis() (compiled from reference/src/*.cpp
 * with only the FFTW backend and image IO swapped out), and dumps the extracted
 * summary statistics as JSON for the JavaScript validation test to compare
 * against. Grayscale (nz=1) path. Parameters match the reference defaults.
 */
#include <cstdio>
#include <cstdlib>
#include <vector>
#include <string>

#include "ps_lib.h"
#include "analysis.h"
#include "constraints.h"
#include "mt19937ar.h"

static void jarr(FILE *fp, const char *name, const float *a, int n, bool comma=true) {
  fprintf(fp, "  \"%s\": [", name);
  for (int i = 0; i < n; i++) fprintf(fp, "%s%.9g", i ? ", " : "", a[i]);
  fprintf(fp, "]%s\n", comma ? "," : "");
}
static void jarr2(FILE *fp, const char *name, float **a, int rows, int cols, bool comma=true) {
  fprintf(fp, "  \"%s\": [\n", name);
  for (int r = 0; r < rows; r++) {
    fprintf(fp, "    [");
    for (int i = 0; i < cols; i++) fprintf(fp, "%s%.9g", i ? ", " : "", a[r][i]);
    fprintf(fp, "]%s\n", r + 1 < rows ? "," : "");
  }
  fprintf(fp, "  ]%s\n", comma ? "," : "");
}

int main(int argc, char **argv) {
  const char *infile  = argc > 1 ? argv[1] : "test/fixture_gray.txt";
  const char *outfile = argc > 2 ? argv[2] : "test/ref_stats.json";

  // read fixture: "nx ny nz" then nx*ny*nz floats
  FILE *fin = fopen(infile, "r");
  if (!fin) { fprintf(stderr, "cannot open %s\n", infile); return 1; }
  int nx, ny, nz;
  if (fscanf(fin, "%d %d %d", &nx, &ny, &nz) != 3) { fprintf(stderr, "bad header\n"); return 1; }
  int N = nx * ny * nz;
  std::vector<float> pix(N);
  for (int i = 0; i < N; i++) if (fscanf(fin, "%f", &pix[i]) != 1) { fprintf(stderr, "short read\n"); return 1; }
  fclose(fin);

  imageStruct sample; sample.image = pix.data(); sample.nx = nx; sample.ny = ny; sample.nz = nz;

  paramsStruct params;
  params.N_steer = 4; params.N_pyr = 4; params.N_iteration = 50; params.Na = 7;
  params.noise = 0; params.edge_handling = 0; params.add_smooth = 0;
  params.cmask[0] = params.cmask[1] = params.cmask[2] = params.cmask[3] = 1;
  params.verbose = 0; params.interpWeight = -1; params.statistics = 0;

  // seed MT exactly as the reference main() does (default seed 0)
  mt_init_genrand(0);

  statsStruct stats;
  allocate_stats(&stats, params, nz);
  analysis(&stats, sample, params);

  int N_pyr = params.N_pyr, N_steer = params.N_steer, Na = params.Na;

  FILE *fp = fopen(outfile, "w");
  fprintf(fp, "{\n");
  fprintf(fp, "  \"meta\": {\"nx\": %d, \"ny\": %d, \"nz\": %d, \"N_pyr\": %d, \"N_steer\": %d, \"Na\": %d},\n",
          nx, ny, nz, N_pyr, N_steer, Na);
  jarr(fp, "pixelStats", stats.pixelStats, N_PIXELSTATS * nz);
  jarr(fp, "skewLow", stats.skewLow, (1 + N_pyr) * nz);
  jarr(fp, "kurtLow", stats.kurtLow, (1 + N_pyr) * nz);
  jarr(fp, "varHigh", stats.varHigh, nz);
  jarr(fp, "magMeans", stats.magMeans, N_pyr * N_steer * nz);
  jarr2(fp, "autoCorLow", stats.autoCorLow, 1 + N_pyr, Na * Na * nz);
  jarr2(fp, "autoCorMag", stats.autoCorMag, N_pyr * N_steer, Na * Na * nz);
  jarr2(fp, "cousinMagCor", stats.cousinMagCor, N_pyr, N_steer * N_steer * nz * nz);
  jarr2(fp, "parentMagCor", stats.parentMagCor, N_pyr - 1, N_steer * N_steer * nz * nz);
  jarr2(fp, "parentRealCor", stats.parentRealCor, N_pyr - 1, 2 * N_steer * N_steer * nz * nz, false);
  fprintf(fp, "}\n");
  fclose(fp);

  free_stats(stats, params, nz);
  fprintf(stderr, "wrote %s\n", outfile);
  return 0;
}
