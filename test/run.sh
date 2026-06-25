#!/bin/bash
# Full validation pipeline:
#   1. decode the reference PNG into a shared numeric fixture (python3 stdlib)
#   2. build + run the C++ reference statistics harness  -> test/ref_stats.json
#   3. run the JS analysis and compare against the reference (jsc)
#   4. run the JS synthesis self-consistency check (jsc)
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

JSC="${JSC:-/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc}"
if [ ! -x "$JSC" ]; then
  for cand in node deno bun; do command -v "$cand" >/dev/null && JSC="$cand" && break; done
fi

echo "== [1/4] decode sample.png -> fixture =="
python3 tools/png_to_fixture.py

echo "== [2/4] build + run C++ reference harness =="
bash reference_harness/build.sh
./reference_harness/ref_stats

echo "== [3/4] JS analysis vs C++ reference =="
"$JSC" test/run_validation.js

echo "== [4/4] JS synthesis convergence =="
"$JSC" test/run_synthesis_check.js
