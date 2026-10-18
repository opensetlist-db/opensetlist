#!/usr/bin/env bash
# Remove a task worktree made by scripts/worktree-new.sh, and its branch.
#
#   scripts/worktree-rm.sh [--force] <path>
#
# Safety rules, in the order they are enforced:
#   - Only a folder directly inside <main checkout>/.claude/worktrees/ is
#     accepted — never the main checkout, never anything else on disk.
#   - A real worktree with uncommitted changes (untracked files
#     included) is refused, and so is one on a detached HEAD — its
#     commits have no branch to survive the removal — unless --force.
#   - The linked node_modules is unlinked FIRST, so nothing below can
#     recurse through it into the main checkout's node_modules.
#   - The branch is deleted only if git agrees it is merged
#     (`git branch -d`); a squash-merged branch is therefore kept.
#
# A leftover folder git no longer knows as a worktree (an earlier removal
# unregistered it but could not delete the folder) is deleted only when
# empty, or with --force after you have looked inside. A folder still in
# use — typically by the session that worked in it — cannot be deleted
# on Windows; the script then exits 2 and a fresh session reruns it.
set -euo pipefail

force=""
if [ "${1:-}" = "--force" ]; then force=1; shift; fi
target="${1:?usage: worktree-rm.sh [--force] <path>}"
[ -d "$target" ] || { echo "no such folder: $target" >&2; exit 1; }

# Physical paths, compared case-insensitively on Windows (drive letters
# and folder names are case-insensitive there; `pwd` keeps the case the
# caller typed).
canon() { (cd "$1" && pwd -P); }
same_path() {
  case "${OSTYPE:-}" in
    msys*) [ "$(printf %s "$1" | tr '[:upper:]' '[:lower:]')" = "$(printf %s "$2" | tr '[:upper:]' '[:lower:]')" ] ;;
    *) [ "$1" = "$2" ] ;;
  esac
}

path="$(canon "$target")"
# git lists the main worktree first; asked from inside the target, this
# also works for a leftover folder (it resolves to the main repo).
main="$(git -C "$path" worktree list --porcelain 2> /dev/null | sed -n '1s/^worktree //p' || true)"
[ -n "$main" ] || main="$(git worktree list --porcelain | sed -n '1s/^worktree //p')"
main="$(canon "$main")"
parent="$(canon "$path/..")"
if ! same_path "$parent" "$main/.claude/worktrees"; then
  echo "refusing: $path is not a folder inside $main/.claude/worktrees/" >&2
  exit 1
fi

# A worktree is a folder that is its own work-tree root. A leftover folder
# under the main checkout resolves to the MAIN checkout's root instead.
toplevel="$(git -C "$path" rev-parse --show-toplevel 2> /dev/null || true)"
registered=""
branch=""
if [ -n "$toplevel" ] && same_path "$(canon "$toplevel")" "$path"; then
  registered=1
  # --untracked-files=all: a user's status.showUntrackedFiles=no must
  # not hide a file that is about to be deleted.
  if [ -n "$(git -C "$path" status --porcelain --untracked-files=all)" ]; then
    echo "refusing: $path has uncommitted changes" >&2
    exit 1
  fi
  branch="$(git -C "$path" symbolic-ref --quiet --short HEAD || true)"
  if [ -z "$branch" ] && [ -z "$force" ]; then
    echo "refusing: $path is on a detached HEAD — create a branch for its commits, or rerun with --force" >&2
    exit 1
  fi
fi

# 1. Unlink node_modules. On Windows `rmdir` without /s removes a
#    junction (or an empty folder) and refuses a real non-empty folder,
#    so it is safe either way; elsewhere `rm` on a symlink removes the
#    link only.
nm="$path/node_modules"
if [ -L "$nm" ] || [ -e "$nm" ]; then
  case "${OSTYPE:-}" in
    msys*) cmd //c rmdir "$(cygpath -w "$nm")" 2> /dev/null || true ;;
    *) if [ -L "$nm" ]; then rm "$nm"; fi ;;
  esac
fi
if [ -L "$nm" ]; then
  echo "refusing: could not unlink $nm" >&2
  exit 1
fi

if [ -z "$registered" ] && [ -z "$force" ] && [ -n "$(ls -A "$path")" ]; then
  echo "refusing: $path is not a worktree and is not empty — look inside, then rerun with --force" >&2
  exit 1
fi

# 2. Remove the worktree. If git refuses (locked, untracked files) and
#    still lists it, stop — that refusal is the safety net. On Windows
#    git often unregisters the worktree and then stops at a folder it
#    can't empty (long paths); only then is the rm -rf below the finish.
if [ -n "$registered" ]; then
  if ! git -C "$main" worktree remove "$path"; then
    # Still a worktree root (the same test as above) = git refused and
    # kept it registered; anything else means git unregistered it.
    still="$(git -C "$path" rev-parse --show-toplevel 2> /dev/null || true)"
    if [ -n "$still" ] && same_path "$(canon "$still")" "$path"; then
      echo "refusing: git would not remove $path (see above); node_modules was unlinked — relink it before using the worktree again" >&2
      exit 1
    fi
  fi
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
  echo "folder still present (in use?): $path — rerun from a fresh session" >&2
  exit 2
fi
echo "removed $path"
