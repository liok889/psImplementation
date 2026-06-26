#!/bin/bash
# Benchmark JS vs native C++ for analysis and synthesis separately.
# Ensures the shared fixture exists, builds the native harness, runs both.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
JSC="${JSC:-/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc}"

[ -f test/fixture_gray.txt ] || python3 tools/png_to_fixture.py

echo "== build native benchmark =="
bash bench/build.sh

echo ""
echo "== native C++ (real FFTW, single-threaded) =="
./bench/bench_native test/fixture_gray.txt 7 5 2>/dev/null

echo ""
echo "== JavaScript (jsc) =="
"$JSC" bench/bench_js.js
