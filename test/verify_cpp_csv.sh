#!/bin/bash
# Verify the reference C++ "-S" CSV statistics output matches the JS raw export.
#   1. (re)generate the shared fixture from sample.png
#   2. run `portilla_simoncelli ... -b 1 -S 1` -> test/cpp_stats.csv
#   3. run the JS analysis and compare value-by-value, in order (jsc)
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
JSC="${JSC:-/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc}"
BIN="reference/portilla_simoncelli"
export DYLD_LIBRARY_PATH="${DYLD_LIBRARY_PATH:-/opt/local/lib}"

if [ ! -x "$BIN" ]; then
  echo "Reference binary not found. Build it first, e.g.:"
  echo "  cd reference && make portilla_simoncelli CC=clang CXX=clang++ \\"
  echo "    CFLAGS=\"-Wall -O3 -march=native -I/opt/local/include -I/opt/local/include/libomp -Xpreprocessor -fopenmp\" \\"
  echo "    LDFLAGS=\"-L/opt/local/lib -L/opt/local/lib/libomp -lm -lpng -ljpeg -ltiff -lstdc++ -lfftw3f -lfftw3f_threads -lomp\""
  exit 1
fi

python3 tools/png_to_fixture.py >/dev/null
"$BIN" reference/data/sample.png -S 1 2>/dev/null > test/cpp_stats.csv
"$JSC" test/verify_cpp_csv.js
