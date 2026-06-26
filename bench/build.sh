#!/bin/bash
# Build the native single-threaded benchmark against the REAL installed FFTW.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
SRC="$ROOT/reference/src"
EIGEN="$SRC/Eigen_library"
# MacPorts FFTW (override with FFTW_PREFIX=/your/prefix)
FFTW_PREFIX="${FFTW_PREFIX:-/opt/local}"

clang++ -std=c++11 -O3 -march=native -DNDEBUG \
  -I "$SRC" -I "$SRC/external" -I "$EIGEN" -I "$FFTW_PREFIX/include" \
  "$HERE/bench_main.cpp" \
  "$SRC/filters.cpp" "$SRC/pyramid.cpp" "$SRC/toolbox.cpp" \
  "$SRC/analysis.cpp" "$SRC/constraints.cpp" "$SRC/pca.cpp" \
  "$SRC/synthesis.cpp" "$SRC/external/mt19937ar.cpp" \
  -L "$FFTW_PREFIX/lib" -lfftw3f -lm \
  -o "$HERE/bench_native"
echo "built $HERE/bench_native"
