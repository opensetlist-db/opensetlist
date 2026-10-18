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

# The main checkout, even when run from inside another worktree.
main="$(cd "$(git rev-parse --path-format=absolute --git-common-dir)/.." && pwd)"
slug="${branch#*/}"
slug="${slug//\//-}"   # feature/a/b → a-b: one folder level
path="$main/.claude/worktrees/$slug"

git -C "$main" fetch origin --quiet
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
