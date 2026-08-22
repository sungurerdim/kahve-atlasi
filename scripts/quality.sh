#!/usr/bin/env bash
# Coffee Atlas quality gate — single entry point, fail-fast.
#
# This project is deliberately buildless: one index.html, no package manager, no build step.
# The gate therefore uses only interpreters already on the machine (python3, node) and installs
# nothing. Signals that have no tool here are declared absent below rather than faked as passing.
#
#   format-check : ABSENT — no formatter is available without introducing a package manager,
#                  which would contradict the project's buildless architecture (gap G11).
#   lint         : covered by the data gate — it evaluates the inline script, so a syntax error
#                  or a throwing definition fails there (exit 2).
#   type-check   : ABSENT — plain ES5-style JavaScript, no type system in play.
#   tests        : the two gates below.
#
# Scope of each step is passed explicitly, so a step that matches nothing fails instead of passing.

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

TARGET="index.html"

if [[ ! -f "$TARGET" ]]; then
  echo "quality: $TARGET is missing — nothing to check, failing rather than passing vacuously." >&2
  exit 2
fi

echo "==> structure gate (scripts/check-html.py $TARGET)"
python3 scripts/check-html.py "$TARGET"

echo
echo "==> dataset invariant gate (scripts/check-data.mjs $TARGET)"
node scripts/check-data.mjs "$TARGET"

echo
echo "quality: all gates green"
