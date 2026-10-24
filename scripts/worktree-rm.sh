#!/usr/bin/env bash
# Remove a task worktree made by scripts/worktree-new.sh, and its branch.
#
#   scripts/worktree-rm.sh [--force] [--dry-run] <path>
#   scripts/worktree-rm.sh --sweep [--dry-run]
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
#     That covers a symlinked .env / .env.local too. The usual Windows
#     form, a hard link, is no link to `find`: deleting it with the
#     worktree removes only the worktree's name for the file, and the
#     main checkout's copy keeps its contents.
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
#
# --dry-run prints what would happen and deletes nothing (not even the
# node_modules link). A leftover folder is reported as "would try": whether
# Windows lets go of it is only known by trying.
#
# --sweep (task-workflow step 1) walks <main checkout>/.claude/worktrees/*
# and prints ONE summary line instead of one message per folder. Each
# folder goes through this very script (one child per folder), so every
# rule above applies unchanged; the sweep only decides which folders to
# hand over:
#   - a registered worktree is handed over only when GitHub has a MERGED
#     PR whose head commit is the branch's current tip. "Branch tip is an
#     ancestor of origin/dev" would also match a fresh worktree nobody has
#     committed to yet, and the worktree this very session is working in.
#     Unmerged, PR-less, or gh unavailable => kept as "active".
#   - the worktree the sweep is run from, and a detached-HEAD worktree
#     (no branch to match a PR against), are always kept as active.
#   - an unregistered leftover folder is handed over as is: it is deleted
#     only when empty (a non-empty one is a real refusal).
# A clean worktree whose branch tip matches a merged PR is removed even
# if another session still has it open, as the manual rule always did.
# Dry-run skips the link scan and does not look inside a real node_modules
# folder, so it can over-report "would remove".
# Summary: removed N / locked M (folders Windows still holds open — exit 2,
# names on one line) / active A / refused K (with the reason). Exit 0 unless
# something was refused; locked and active folders alone are not a failure.
set -euo pipefail

# Windows deletion never passes an enumerated path list to cmd/MSYS. Keep the
# POSIX implementation below for Linux/macOS; Windows uses the native helper.
case "${OSTYPE:-}" in
  msys*|cygwin*)
    native="$(cygpath -w "$(dirname "${BASH_SOURCE[0]}")/worktree-rm.ps1")"
    args=()
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --dry-run) args+=(-DryRun); shift ;;
        --sweep) args+=(-Sweep); shift ;;
        --released-head|--merge-ref|--archive-manifest)
          [ "$#" -ge 2 ] || { echo "missing value: $1" >&2; exit 1; }
          case "$1" in
            --released-head) args+=(-ReleasedHead "$2") ;;
            --merge-ref) args+=(-MergeRef "$2") ;;
            --archive-manifest) args+=(-ArchiveManifest "$(cygpath -aw "$2")") ;;
          esac
          shift 2 ;;
        --force) echo '--force is not supported on Windows; preserve dirty/unmerged/unregistered data' >&2; exit 1 ;;
        -*) echo "unknown option: $1" >&2; exit 1 ;;
        *) args+=(-Path "$(cygpath -aw "$1")"); shift ;;
      esac
    done
    exec powershell.exe -NoProfile -NonInteractive -File "$native" "${args[@]}"
    ;;
esac

force=""
dry=""
sweep=""
target=""
for a in "$@"; do
  case "$a" in
    --force) force=1 ;;
    --dry-run) dry=1 ;;
    --sweep) sweep=1 ;;
    -*) echo "unknown option: $a" >&2; exit 1 ;;
    *) [ -z "$target" ] || { echo "only one path allowed" >&2; exit 1; }; target="$a" ;;
  esac
done

if [ -n "$sweep" ]; then
  if [ -n "$force" ] || [ -n "$target" ]; then
    echo "usage: worktree-rm.sh --sweep [--dry-run] (no --force, no path)" >&2
    exit 1
  fi
  main="$(git worktree list --porcelain | sed -n '1s/^worktree //p')"
  main="$(cd "$main" && pwd -P)"
  here="$(git rev-parse --show-toplevel 2> /dev/null || true)"
  [ -z "$here" ] || here="$(cd "$here" && pwd -P)"
  # Absolute path, run through bash: $0 may be a bare name or lack the exec bit.
  self="$(cd "$(dirname "$0")" && pwd -P)/$(basename "$0")"
  removed=0 locked_n=0 active_n=0 refused_n=0
  locked="" active="" refused=""
  for dir in "$main"/.claude/worktrees/*/; do
    [ -d "$dir" ] || continue
    dir="$(cd "$dir" && pwd -P)"
    name="$(basename "$dir")"
    if [ -n "$here" ] && [ "$(printf %s "$dir" | tr '[:upper:]' '[:lower:]')" = "$(printf %s "$here" | tr '[:upper:]' '[:lower:]')" ]; then
      active_n=$((active_n + 1)); active="$active $name(self)"; continue
    fi
    top="$(git -C "$dir" rev-parse --show-toplevel 2> /dev/null || true)"
    if [ -n "$top" ] && [ "$(cd "$top" && pwd -P | tr '[:upper:]' '[:lower:]')" = "$(printf %s "$dir" | tr '[:upper:]' '[:lower:]')" ]; then
      br="$(git -C "$dir" symbolic-ref --quiet --short HEAD || true)"
      tip="$(git -C "$dir" rev-parse HEAD 2> /dev/null || true)"
      if [ -z "$br" ] || [ -z "$tip" ]; then
        # No branch to match a PR against; the commits may exist nowhere else.
        active_n=$((active_n + 1)); active="$active $name($([ -n "$br" ] && echo unreadable || echo detached))"; continue
      else
        merged="$(gh pr list --head "$br" --state merged --json headRefOid --jq "map(select(.headRefOid==\"$tip\"))|length" 2> /dev/null || true)"
      fi
      if [ "${merged:-0}" = "0" ]; then
        active_n=$((active_n + 1)); active="$active $name"; continue
      fi
    fi
    rc=0
    out="$(bash "$self" ${dry:+--dry-run} "$dir" 2>&1)" || rc=$?
    case "$rc" in
      3) echo "$out" >&2; echo "worktree sweep aborted: the main checkout lost files (exit 3 from $name)" >&2; exit 3 ;;
      0) removed=$((removed + 1)) ;;
      2) locked_n=$((locked_n + 1)); locked="$locked $name" ;;
      *) refused_n=$((refused_n + 1)); refused="$refused
  $name: $(printf %s "$out" | grep -v '^$' | tail -n 1)" ;;
    esac
  done
  verb="removed"; [ -z "$dry" ] || verb="would try to remove"
  echo "worktree sweep${dry:+ (dry-run)}: $verb $removed, locked $locked_n${locked:+ (${locked# })}, active $active_n${active:+ (${active# })}, refused $refused_n"
  [ -z "$refused" ] || printf '%s
' "${refused#
}"
  exit $((refused_n > 0))
fi

[ -n "$target" ] || { echo "usage: worktree-rm.sh [--force] [--dry-run] <path>  |  --sweep [--dry-run]" >&2; exit 1; }
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

if [ -n "$dry" ]; then
  # Same refusals as a real run up to here, minus everything that touches
  # the disk. A node_modules entry is assumed to be the link a real run
  # unlinks first; anything else in an unregistered folder is a refusal.
  others="$(ls -A "$path" | grep -vx node_modules || true)"
  if [ -z "$registered" ] && [ -z "$force" ] && [ -n "$others" ]; then
    echo "refusing: $path is not a worktree and is not empty — look inside, then rerun with --force" >&2
    exit 1
  fi
  if [ -n "$registered" ]; then
    echo "would remove worktree $path (branch ${branch:-detached})"
  else
    echo "would try to delete leftover folder $path"
  fi
  exit 0
fi

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
