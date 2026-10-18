#!/usr/bin/env bash
# Remove a task worktree made by scripts/worktree-new.sh, and its branch.
#
#   scripts/worktree-rm.sh <path>
#
# Order matters: the linked node_modules is unlinked FIRST, so nothing
# below can recurse through it into the main checkout's node_modules.
# Refuses a worktree with uncommitted changes, and keeps a branch git
# does not consider merged (`git branch -d` semantics).
#
# Also accepts a leftover folder that git no longer lists as a worktree
# (an earlier removal unregistered it but could not delete the folder).
# A folder still in use — typically by the session that worked in it —
# cannot be deleted on Windows; run this from a fresh session.
set -euo pipefail

target="${1:?usage: worktree-rm.sh <path>}"
[ -d "$target" ] || { echo "no such folder: $target" >&2; exit 1; }
path="$(cd "$target" && pwd)"
# git prints worktree paths in its native form (F:/work/... on Windows,
# where bash says /f/work/...); compare in that form.
native="$(cd "$target" && { pwd -W 2> /dev/null || pwd; })"
main="$(cd "$(git rev-parse --git-common-dir)/.." && pwd)"

registered=""
branch=""
if git -C "$main" worktree list --porcelain | grep -qxF "worktree $native"; then
  registered=1
  if [ -n "$(git -C "$path" status --porcelain)" ]; then
    echo "refusing: $path has uncommitted changes" >&2
    exit 1
  fi
  branch="$(git -C "$path" symbolic-ref --quiet --short HEAD || true)"
fi

# 1. Unlink node_modules. On Windows `rmdir` without /s removes a
#    junction (or an empty folder) and refuses a real non-empty folder,
#    so it is safe either way; elsewhere `rm` on a symlink removes the
#    link only.
nm="$path/node_modules"
if [ -L "$nm" ] || [ -e "$nm" ]; then
  case "${OSTYPE:-}" in
    msys*|cygwin*) cmd //c rmdir "$(cygpath -w "$nm")" 2> /dev/null || true ;;
    *) [ -L "$nm" ] && rm "$nm" ;;
  esac
fi
if [ -L "$nm" ]; then
  echo "refusing: could not unlink $nm" >&2
  exit 1
fi

# 2. Remove the worktree; finish by hand when git stops at a folder it
#    can't empty (long paths, a real node_modules from `npm ci`).
if [ -n "$registered" ]; then
  git -C "$main" worktree remove "$path" 2> /dev/null || true
fi
if [ -d "$path" ]; then
  rm -rf "$path" 2> /dev/null || true
fi
git -C "$main" worktree prune

# 3. Delete the branch only if git agrees it is merged.
if [ -n "$branch" ]; then
  git -C "$main" branch -d "$branch" || echo "kept branch $branch (not merged)" >&2
fi

if [ -d "$path" ]; then
  echo "folder still present (in use?): $path — unregistered; rerun from a fresh session" >&2
  exit 2
fi
echo "removed $path"
