#!/usr/bin/env bash
# Install the repo's git hooks (scripts/hooks/*) into the hooks directory
# git actually reads: `core.hooksPath` when set, otherwise the COMMON
# dir's hooks/ (with worktrees), so one install covers the main checkout
# and every worktree. `git rev-parse --git-path hooks` resolves both.
#
#   scripts/install-git-hooks.sh
#
# A hook carrying the `managed-by` marker line is ours and is updated in
# place, so re-running after a hook changes upgrades it. Any other
# existing hook is left alone (it may be the owner's own); the script
# says so and exits 1.
set -euo pipefail

src="$(cd "$(dirname "$0")/hooks" && pwd)"
dest="$(git rev-parse --path-format=absolute --git-path hooks)"
mkdir -p "$dest"

status=0
for f in "$src"/*; do
  name="$(basename "$f")"
  target="$dest/$name"
  if [ -e "$target" ] && ! cmp -s "$f" "$target" \
    && ! grep -q '^# managed-by: scripts/install-git-hooks.sh' "$target"; then
    echo "skip $name: $target exists and is not managed by this script" >&2
    status=1
    continue
  fi
  cp "$f" "$target"
  chmod +x "$target"
  echo "installed $name → $target"
done
exit "$status"
