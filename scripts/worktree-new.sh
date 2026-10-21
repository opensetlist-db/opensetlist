#!/usr/bin/env bash
# Create a task worktree under .claude/worktrees/ that is ready to run
# tests and the typechecker without a fresh `npm ci` (~10 min on Windows).
#
#   scripts/worktree-new.sh <branch> [base-ref]     base defaults to origin/dev
#
# What a plain `git worktree add` leaves out, and this adds:
#   - the files listed in .worktreeinclude (env files, owner-local notes).
#     Claude Code applies that list only to worktrees IT creates.
#   - src/generated/ (the gitignored Prisma client — normally produced by
#     `npm ci`'s postinstall, which a linked node_modules never runs).
#     It is a snapshot: after merging a schema change into the worktree,
#     run `npx prisma generate` there (it writes only src/generated/).
#   - node_modules, LINKED to the main checkout's (a junction on Windows,
#     a symlink elsewhere). The worktree starts from the same lockfile.
#     After a dependency change, UNLINK first (`cmd //c rmdir node_modules`
#     on Windows, `rm node_modules` elsewhere) and only then `npm ci` —
#     installing through the link would rewrite the main checkout's.
#
# Remove the worktree with scripts/worktree-rm.sh, never a bare
# `rm -rf`: a recursive delete can follow the link into the main
# checkout's node_modules.
set -euo pipefail

branch="${1:?usage: worktree-new.sh <branch> [base-ref]}"
base="${2:-origin/dev}"

# The main checkout, even when run from inside another worktree: git
# lists the main worktree first (its path, unlike the common dir's
# parent, is right even for a --separate-git-dir repo).
main="$(git worktree list --porcelain | sed -n '1s/^worktree //p')"
main="$(cd "$main" && pwd)"
slug="${branch#*/}"
slug="${slug//\//-}"   # feature/a/b → a-b: one folder level
path="$main/.claude/worktrees/$slug"

# Refuse to hand out a damaged node_modules: the link below shares the
# main checkout's copy with every worktree, and an emptied package there
# only shows up later as a confusing `Cannot find module` or a wall of
# tsc errors. Checked before `worktree add` so a failure leaves nothing
# to clean up. The checker comes from THIS script's checkout — the main
# checkout may sit on a branch that predates it. Exit 2 (no lockfile or
# no node_modules) is not damage: the link step below handles a missing
# node_modules with its own note.
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
rc=0
node "$script_dir/check-node-modules.mjs" "$main" || rc=$?
case "$rc" in
  0|2) ;;
  3)
    echo "worktree-new: main checkout's node_modules is damaged — repair it, then rerun" >&2
    exit 1
    ;;
  *)
    echo "worktree-new: node_modules check failed to run (exit $rc) — see the error above" >&2
    exit 1
    ;;
esac

# Only a remote-tracking base needs refreshing; a local base (HEAD, a
# local branch) must not depend on the network.
case "$base" in
  origin/*) git -C "$main" fetch origin --quiet ;;
esac
git -C "$main" worktree add -b "$branch" "$path" "$base"

if [ -f "$main/.worktreeinclude" ]; then
  while IFS= read -r f || [ -n "$f" ]; do
    f="${f%$'\r'}"
    case "$f" in ''|\#*) continue ;; esac
    if [ -e "$main/$f" ]; then
      mkdir -p "$(dirname "$path/$f")"
      # Copy INTO the parent so an existing directory isn't nested.
      cp -R "$main/$f" "$(dirname "$path/$f")/"
    fi
  done < "$main/.worktreeinclude"
fi

if [ -d "$main/src/generated" ]; then
  mkdir -p "$path/src"
  cp -R "$main/src/generated" "$path/src/"
fi

if [ -d "$main/node_modules" ]; then
  case "${OSTYPE:-}" in
    msys*)
      # Git Bash: a junction needs no admin rights or developer mode (a
      # symlink does). `cmd //c` is the MSYS spelling.
      cmd //c mklink //J "$(cygpath -w "$path/node_modules")" "$(cygpath -w "$main/node_modules")" > /dev/null
      ;;
    *)
      ln -s "$main/node_modules" "$path/node_modules"
      ;;
  esac
else
  echo "note: $main/node_modules is missing — run \`npm ci\` in the worktree" >&2
fi

echo "$path"
