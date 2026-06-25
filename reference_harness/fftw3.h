/* Minimal FFTW3 single-precision API shim.
 *
 * The Portilla-Simoncelli reference depends on libfftw3f, which is unavailable
 * in this environment. This header provides exactly the subset of the FFTW API
 * the reference uses, backed by a self-contained radix-2 + Bluestein FFT
 * (fftw_shim.cpp). It lets us compile the genuine reference statistics code
 * (filters/pyramid/analysis/constraints/pca) unmodified and obtain ground-truth
 * statistics to validate the JavaScript port against.
 *
 * Conventions reproduced faithfully:
 *   FFTW_FORWARD  (-1): X[k] = sum_n x[n] e^{-2 pi i k n / N}     (unnormalized)
 *   FFTW_BACKWARD (+1): x[n] = sum_k X[k] e^{+2 pi i k n / N}     (unnormalized)
 *   2D arrays are row-major; fftwf_plan_dft_2d(ny, nx, ...).
 */
#ifndef FFTW3_SHIM_H
#define FFTW3_SHIM_H

#include <stdlib.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef float fftwf_complex[2];

typedef struct fftwf_plan_s {
  int nx, ny;          /* nx = fast/inner dimension (columns), ny = rows */
  int sign;            /* FFTW_FORWARD or FFTW_BACKWARD */
  fftwf_complex *in;   /* bound input buffer  */
  fftwf_complex *out;  /* bound output buffer */
} *fftwf_plan;

#define FFTW_FORWARD  (-1)
#define FFTW_BACKWARD (+1)
#define FFTW_ESTIMATE (0U)
#define FFTW_MEASURE  (0U)

void *fftwf_malloc(size_t n);
void  fftwf_free(void *p);

fftwf_plan fftwf_plan_dft_2d(int n0, int n1, fftwf_complex *in,
                             fftwf_complex *out, int sign, unsigned flags);
void fftwf_execute(const fftwf_plan plan);
void fftwf_destroy_plan(fftwf_plan plan);

/* threading no-ops */
int  fftwf_init_threads(void);
void fftwf_plan_with_nthreads(int nthreads);
void fftwf_cleanup(void);
void fftwf_cleanup_threads(void);

#ifdef __cplusplus
}
#endif

#endif
