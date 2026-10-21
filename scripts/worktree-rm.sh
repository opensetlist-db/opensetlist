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
#   - Every other link in the worktree (the junctions `next build` puts
#     under .next/node_modules/) is unlinked next; if one survives, stop.
#   - After the removal, the main checkout's node_modules is checked
#     (exit 3 if packages vanished).
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

# The main checkout's node_modules must come out of the removal intact.
# These are packages `next build` links from .next/node_modules, plus
# next itself; a delete that followed one of those links would empty it.
# Snapshotted before anything is unlinked, so the check after step 2
# also covers the unlinking. Only those present now are checked.
sentinels=()
for p in next @prisma/client pg kuromoji; do
  f="$main/node_modules/$p/package.json"
  [ -e "$f" ] && sentinels+=("$f")
done
if [ ${#sentinels[@]} -eq 0 ]; then
  echo "warning: $main/node_modules has none of next, @prisma/client, pg, kuromoji — the after-removal check of the main checkout is off" >&2
fi
check_main() {
  local f bad=""
  for f in ${sentinels[@]+"${sentinels[@]}"}; do
    [ -e "$f" ] || bad="$bad $f"
  done
  if [ -n "$bad" ]; then
    echo "DANGER: removing $path deleted files in the main checkout's node_modules (missing:$bad). Run \`npm ci\` in $main." >&2
    exit 3
  fi
}

# Remove one link, never what it points at. On Windows `rmdir` without
# /s removes a directory junction or symlink — dangling ones included —
# (or an empty folder) and refuses a real non-empty folder. A file
# symlink needs `del`, but `del` on a LIVE directory link deletes the
# files inside its target, so it runs only when rmdir failed and the
# path is not a directory. Elsewhere `rm` on a symlink removes the link.
unlink_link() {
  case "${OSTYPE:-}" in
    msys*)
      cmd //c rmdir "$(cygpath -w "$1")" > /dev/null 2>&1 || true
      if [ -L "$1" ] && [ ! -d "$1" ]; then
        cmd //c del //q "$(cygpath -w "$1")" > /dev/null 2>&1 || true
      fi
      ;;
    *) if [ -L "$1" ]; then rm "$1"; fi ;;
  esac
}

# 1. Unlink node_modules first, so nothing below can recurse through it.
nm="$path/node_modules"
if [ -L "$nm" ] || [ -e "$nm" ]; then
  unlink_link "$nm"
fi
if [ -L "$nm" ]; then
  echo "refusing: could not unlink $nm" >&2
  exit 1
fi

if [ -z "$registered" ] && [ -z "$force" ] && [ -n "$(ls -A "$path")" ]; then
  echo "refusing: $path is not a worktree and is not empty — look inside, then rerun with --force" >&2
  exit 1
fi

# 1b. Unlink every other link under the worktree. `next build` on Windows
#     creates junctions at .next/node_modules/<pkg>-<hash> that point at
#     server-external packages (pg, @prisma/client, kuromoji, ...) in the
#     MAIN checkout's node_modules — through our node_modules link, but
#     resolved to the real path. Git for Windows' `git worktree remove`
#     recurses through a junction and empties its target (reproduced with
#     git 2.44; MSYS `rm -rf` does not), so every link must be gone before
#     step 2. MSYS reports junctions and symlinks alike as `-type l`, and
#     `find` never descends into one, so the scan itself cannot leave the
#     worktree. A worktree with its own real node_modules is scanned too:
#     slower, but a link in there is no safer than one in .next. A scan
#     that errors (unreadable folder) could have missed a link: stop.
list_links() {
  find "$path" -type l || {
    echo "refusing: could not scan $path for links (see above)" >&2
    exit 1
  }
}
links="$(list_links)"
while IFS= read -r link; do
  [ -n "$link" ] || continue
  unlink_link "$link"
done <<< "$links"
surviving="$(list_links)"
if [ -n "$surviving" ]; then
  echo "refusing: could not unlink these links under $path — remove them by hand (rmdir without /s), then rerun; node_modules was unlinked — relink it before using the worktree again:" >&2
  printf '%s\n' "$surviving" | sed 's/^/  /' >&2
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
      check_main
      echo "refusing: git would not remove $path (see above); node_modules was unlinked — relink it before using the worktree again" >&2
      exit 1
    fi
  fi
fi
if [ -d "$path" ]; then
  rm -rf "$path" 2> /dev/null || true
fi
check_main
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
