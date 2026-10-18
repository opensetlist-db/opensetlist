#!/usr/bin/env bash
# Install the repo's git hooks (scripts/hooks/*) into the hooks directory
# git actually reads. With worktrees that is the COMMON dir's hooks/, so
# one install covers the main checkout and every worktree.
#
#   scripts/install-git-hooks.sh
#
# An existing hook with different content is left alone (it may be the
# owner's own); the script says so and exits 1.
set -euo pipefail

src="$(cd "$(dirname "$0")/hooks" && pwd)"
dest="$(git rev-parse --path-format=absolute --git-common-dir)/hooks"
mkdir -p "$dest"

status=0
for f in "$src"/*; do
  name="$(basename "$f")"
  target="$dest/$name"
  if [ -e "$target" ] && ! cmp -s "$f" "$target"; then
    echo "skip $name: $target exists with other content" >&2
    status=1
    continue
  fi
  cp "$f" "$target"
  chmod +x "$target"
  echo "installed $name → $target"
done
exit "$status"
