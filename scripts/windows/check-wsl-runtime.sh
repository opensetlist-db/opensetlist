#!/usr/bin/env bash
set -eu
for prerequisite in node npm lsof curl; do
  command -v "$prerequisite" > /dev/null || { echo "missing Linux command: $prerequisite" >&2; exit 1; }
done
[ "$(node -p process.platform)" = linux ] || { echo 'WSL requires Linux Node, not node.exe' >&2; exit 1; }
