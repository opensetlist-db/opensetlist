#!/usr/bin/env bash
# Create a task worktree under .claude/worktrees/ that is ready to run
# tests and the typechecker without a fresh `npm ci` (~10 min on Windows).
#
#   scripts/worktree-new.sh <branch> [base-ref]     base defaults to origin/dev
#
# What a plain `git worktree add` leaves out, and this adds:
#   - the files listed in .worktreeinclude (env files, owner-local notes).
#     Claude Code applies that list only to worktrees IT creates (and
#     copies every entry; only this script links the env files).
#   - .env and .env.local, LINKED to the main checkout's rather than
#     copied: a copy freezes the values of the day the worktree was made,
#     and a variable added to the main checkout later (the R2_* upload
#     credentials) never reaches it. On Windows a file symlink needs
#     developer mode or admin, so a hard link (`mklink /H`, no privileges,
#     same volume — always true under .claude/worktrees/) is the usual
#     result; elsewhere a symlink. If neither works, it falls back to a
#     copy with a warning. Both kinds of link share the bytes: a write
#     to the worktree's file changes the main checkout's. A hard link
#     silently turns into a copy when either side is replaced rather
#     than rewritten in place (an editor's write-to-temp-then-rename
#     save); `ls -l` shows a link count of 1 then — relink by hand
#     (`rm .env.local && cmd //c mklink //H .env.local
#     "$(cygpath -w <main>/.env.local)"`).
#     Removing the worktree deletes only its own name for the file.
#   - src/generated/ (the gitignored Prisma client — normally produced by
#     `npm ci`'s postinstall, which a linked node_modules never runs).
#     It is a snapshot: after merging a schema change into the worktree,
#     run `npx prisma generate` there (it writes only src/generated/).
#   - node_modules, LINKED to the main checkout's (a junction on Windows,
#     a symlink elsewhere), when it satisfies the NEW worktree's lockfile.
#     The base branch can depend on a package the main checkout's branch
#     lacks (feature/redesign added aws4fetch while the main checkout sat
#     on dev → `Cannot find module 'aws4fetch'` in every redesign
#     worktree). So after linking, the worktree's lockfile is checked
#     against the linked copy; on a mismatch the link is removed again
#     and the script exits 4 with the worktree created but WITHOUT
#     node_modules: run `npm ci` in it yourself, in the background. Not
#     run here because it takes ~10 min on Windows — longer than an
#     agent's foreground command limit, and a killed `npm ci` leaves a
#     half-installed tree that looks present.
#     After a later dependency change, UNLINK first (`cmd //c rmdir
#     node_modules` on Windows, `rm node_modules` elsewhere) and only then
#     `npm ci`. Never `npm install` through the link: it rewrites the main
#     checkout's copy for every worktree, and on Windows it has replaced
#     the junction with a real directory mid-install.
#
# Exit status: 0 ready; 4 worktree created but node_modules must be
# installed (see above); anything else, a failure (stderr says which).
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

# Link one file from the main checkout into the worktree (see the header
# for why, and why a hard link is the usual result on Windows). Each
# attempt leaves nothing behind when it fails, so the next can run.
link_file() {
  local src="$main/$1" dst="$path/$1"
  mkdir -p "$(dirname "$dst")"
  case "${OSTYPE:-}" in
    msys*)
      # Not `ln -s`: without developer mode MSYS quietly makes a copy.
      local wsrc wdst
      wsrc="$(cygpath -w "$src")"
      wdst="$(cygpath -w "$dst")"
      if cmd //c mklink "$wdst" "$wsrc" > /dev/null 2>&1; then return 0; fi
      if cmd //c mklink //H "$wdst" "$wsrc" > /dev/null 2>&1; then return 0; fi
      ;;
    *)
      if ln -s "$src" "$dst" 2> /dev/null; then return 0; fi
      ;;
  esac
  cp "$src" "$dst"
  echo "warning: could not link $1 to the main checkout's — copied it instead; later changes there will not reach this worktree" >&2
}

if [ -f "$main/.worktreeinclude" ]; then
  while IFS= read -r f || [ -n "$f" ]; do
    f="${f%$'\r'}"
    case "$f" in ''|\#*) continue ;; esac
    case "$f" in
      .env|.env.local)
        if [ -f "$main/$f" ]; then link_file "$f"; fi
        continue
        ;;
    esac
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

  # The check above ran against the MAIN checkout's lockfile; this one
  # runs against the worktree's, through the link. Exit 2 here means the
  # base has no usable lockfile, so there is nothing to compare against:
  # the link stays, with a note. Anything but 0/2/3 is the checker itself
  # failing. Its report goes to a file outside the worktree so a failure
  # here leaves no untracked file behind.
  report="$(mktemp)"
  rc=0
  node "$script_dir/check-node-modules.mjs" "$path" > /dev/null 2> "$report" || rc=$?
  case "$rc" in
    0) rm -f "$report" ;;
    2)
      cat "$report" >&2
      rm -f "$report"
      echo "note: node_modules is linked to the main checkout's but could not be checked against $base (see above)" >&2
      ;;
    3)
      # Remove the LINK only — the same commands the header gives (rmdir
      # without /s refuses a real non-empty folder, so it cannot empty
      # the main checkout's copy; `rm` without -r removes a symlink).
      case "${OSTYPE:-}" in
        msys*) cmd //c rmdir "$(cygpath -w "$path/node_modules")" > /dev/null || true ;;
        *) rm "$path/node_modules" || true ;;
      esac
      if [ -L "$path/node_modules" ] || [ -e "$path/node_modules" ]; then
        rm -f "$report"
        echo "worktree-new: could not unlink $path/node_modules — remove the link by hand (rmdir without /s), then run \`npm ci\` there" >&2
        exit 1
      fi
      # Only the package lines: the checker's repair recipe is for a
      # damaged copy, not for a branch that needs other packages.
      grep -E '^  node_modules/' "$report" | head -20 >&2 || true
      rm -f "$report"
      echo "$path"
      echo "worktree-new: $base needs packages the main checkout's node_modules lacks (above) — the worktree has NO node_modules. Run \`npm ci\` in $path (in the background: ~10 min on Windows). Do not link it back." >&2
      exit 4
      ;;
    *)
      cat "$report" >&2
      rm -f "$report"
      echo "worktree-new: node_modules check of the worktree failed to run (exit $rc) — node_modules is still linked; verify it before use" >&2
      exit 1
      ;;
  esac
else
  echo "note: $main/node_modules is missing — run \`npm ci\` in the worktree" >&2
fi

echo "$path"
