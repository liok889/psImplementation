/* Implementation of the minimal FFTW3 shim declared in fftw3.h.
 * Self-contained radix-2 + Bluestein FFT. Computation is done in double for
 * accuracy, then stored back to the float[2] fftwf_complex buffers. */
#include "fftw3.h"
#include <math.h>
#include <vector>

static bool isPow2(int n) { return (n & (n - 1)) == 0; }

// in-place radix-2, sign=-1 forward / +1 inverse, no normalization
static void fftRadix2(double *re, double *im, int n, int sign) {
  for (int i = 1, j = 0; i < n; i++) {
    int bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { double t; t=re[i];re[i]=re[j];re[j]=t; t=im[i];im[i]=im[j];im[j]=t; }
  }
  for (int len = 2; len <= n; len <<= 1) {
    double ang = sign * 2.0 * M_PI / len;
    double wr = cos(ang), wi = sin(ang);
    for (int s = 0; s < n; s += len) {
      double cwr = 1, cwi = 0; int half = len >> 1;
      for (int k = 0; k < half; k++) {
        int a = s + k, b = a + half;
        double xr = re[b]*cwr - im[b]*cwi;
        double xi = re[b]*cwi + im[b]*cwr;
        re[b] = re[a]-xr; im[b] = im[a]-xi;
        re[a] += xr;      im[a] += xi;
        double ncwr = cwr*wr - cwi*wi; cwi = cwr*wi + cwi*wr; cwr = ncwr;
      }
    }
  }
}

static void fftBluestein(double *re, double *im, int n, int sign) {
  int m = 1; while (m < 2*n-1) m <<= 1;
  std::vector<double> ar(m,0), ai(m,0), br(m,0), bi(m,0), cosT(n), sinT(n);
  for (int i = 0; i < n; i++) {
    long long j = (long long)i*i % (2LL*n);
    double ang = sign * M_PI * (double)j / n;
    cosT[i] = cos(ang); sinT[i] = sin(ang);
    ar[i] = re[i]*cosT[i] - im[i]*sinT[i];
    ai[i] = re[i]*sinT[i] + im[i]*cosT[i];
  }
  br[0] = cosT[0]; bi[0] = -sinT[0];
  for (int k = 1; k < n; k++) { br[k]=br[m-k]=cosT[k]; bi[k]=bi[m-k]=-sinT[k]; }
  fftRadix2(ar.data(), ai.data(), m, -1);
  fftRadix2(br.data(), bi.data(), m, -1);
  for (int t = 0; t < m; t++) {
    double rr = ar[t]*br[t]-ai[t]*bi[t];
    double ii = ar[t]*bi[t]+ai[t]*br[t];
    ar[t]=rr; ai[t]=ii;
  }
  fftRadix2(ar.data(), ai.data(), m, +1);
  double inv = 1.0/m;
  for (int p = 0; p < n; p++) {
    double xr = ar[p]*inv, xi = ai[p]*inv;
    re[p] = xr*cosT[p] - xi*sinT[p];
    im[p] = xr*sinT[p] + xi*cosT[p];
  }
}

static void transform1d(double *re, double *im, int n, int sign) {
  if (n <= 1) return;
  if (isPow2(n)) fftRadix2(re, im, n, sign); else fftBluestein(re, im, n, sign);
}

extern "C" {

void *fftwf_malloc(size_t n) { return malloc(n); }
void  fftwf_free(void *p) { free(p); }

fftwf_plan fftwf_plan_dft_2d(int n0, int n1, fftwf_complex *in,
                             fftwf_complex *out, int sign, unsigned flags) {
  (void)flags;
  fftwf_plan p = (fftwf_plan)malloc(sizeof(struct fftwf_plan_s));
  p->ny = n0; p->nx = n1; p->sign = sign; p->in = in; p->out = out;
  return p;
}

void fftwf_execute(const fftwf_plan plan) {
  int nx = plan->nx, ny = plan->ny, N = nx*ny;
  std::vector<double> re(N), im(N), row(0);
  for (int i = 0; i < N; i++) { re[i] = plan->in[i][0]; im[i] = plan->in[i][1]; }
  std::vector<double> rr(nx > ny ? nx : ny), ri(nx > ny ? nx : ny);
  // rows
  for (int y = 0; y < ny; y++) {
    int off = y*nx;
    for (int x = 0; x < nx; x++) { rr[x]=re[off+x]; ri[x]=im[off+x]; }
    transform1d(rr.data(), ri.data(), nx, plan->sign);
    for (int x = 0; x < nx; x++) { re[off+x]=rr[x]; im[off+x]=ri[x]; }
  }
  // columns
  for (int x = 0; x < nx; x++) {
    for (int y = 0; y < ny; y++) { int idx=x+y*nx; rr[y]=re[idx]; ri[y]=im[idx]; }
    transform1d(rr.data(), ri.data(), ny, plan->sign);
    for (int y = 0; y < ny; y++) { int idx=x+y*nx; re[idx]=rr[y]; im[idx]=ri[y]; }
  }
  for (int i = 0; i < N; i++) { plan->out[i][0] = (float)re[i]; plan->out[i][1] = (float)im[i]; }
}

void fftwf_destroy_plan(fftwf_plan plan) { free(plan); }
int  fftwf_init_threads(void) { return 1; }
void fftwf_plan_with_nthreads(int nthreads) { (void)nthreads; }
void fftwf_cleanup(void) {}
void fftwf_cleanup_threads(void) {}

}
