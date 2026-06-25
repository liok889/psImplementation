#!/bin/bash
# Build the reference statistics harness: genuine reference statistics code
# (filters/pyramid/analysis/constraints/pca) compiled against the FFTW shim
# and a plain-text fixture reader. Eigen is taken from the bundled copy.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
SRC="$ROOT/reference/src"
EIGEN="$SRC/Eigen_library"

g++ -std=c++11 -O2 \
  -I "$HERE" -I "$SRC" -I "$SRC/external" -I "$EIGEN" \
  "$HERE/ref_main.cpp" \
  "$HERE/fftw_shim.cpp" \
  "$SRC/filters.cpp" \
  "$SRC/pyramid.cpp" \
  "$SRC/toolbox.cpp" \
  "$SRC/analysis.cpp" \
  "$SRC/constraints.cpp" \
  "$SRC/pca.cpp" \
  "$SRC/external/mt19937ar.cpp" \
  -o "$HERE/ref_stats"
echo "built $HERE/ref_stats"
