#!/usr/bin/env bash
# The Vercel deployment GitHub recorded for a commit: its latest status
# and its immutable URL.
#
#   scripts/preview-url.sh <sha | branch | pr-number>
#
#   1–6 digits   → a PR number (its head commit, `gh pr view`)
#   7–40 hex     → a commit (a short one is expanded by `git rev-parse`)
#   anything else → a branch (`origin/<branch>`, fetched first)
#   A branch whose name is all hex: pass `origin/<name>`'s sha instead.
#
# Prints the commit, the latest status state, the environment and the
# status's `environment_url` (the per-commit site URL; "-" while the
# build has none yet). Exits 1 with "no deployment yet" when Vercel has
# not reported one for that commit.
#
# Why: the branch alias (`opensetlist-git-dev-…vercel.app`) can lag the
# branch head — it moves only when the newest build finishes — so
# evidence taken from it may describe an older commit. PR evidence must
# use the per-commit URL this prints. Admin cookies are host-scoped:
# sign in to admin again on each deployment URL.
set -euo pipefail

ref="${1:?usage: preview-url.sh <sha|branch|pr-number>}"
repo="opensetlist-db/opensetlist"

if [[ "$ref" =~ ^[0-9]{1,6}$ ]]; then
  sha="$(gh pr view "$ref" --repo "$repo" --json headRefOid --jq .headRefOid)"
elif [[ "$ref" =~ ^[0-9a-fA-F]{7,40}$ ]]; then
  sha="$(git rev-parse --verify --quiet "$ref^{commit}" || true)"
  if [ -z "$sha" ]; then
    # Not known locally: only a full sha can be sent as is.
    [ "${#ref}" -eq 40 ] || { echo "unknown commit $ref (fetch first, or pass the full sha)" >&2; exit 2; }
    sha="$ref"
  fi
else
  git fetch origin "$ref" --quiet
  sha="$(git rev-parse "origin/$ref")"
fi

# Newest first; one commit can have several (Preview, Production).
deployment="$(gh api "repos/$repo/deployments?sha=$sha&per_page=1" --jq '.[0] | select(. != null) | "\(.id) \(.environment)"')"
if [ -z "$deployment" ]; then
  echo "no deployment yet for $sha" >&2
  exit 1
fi
read -r id environment <<< "$deployment"

status="$(gh api "repos/$repo/deployments/$id/statuses?per_page=1" --jq '.[0] | select(. != null) | "\(.state) \(.environment_url // "-")"')"
if [ -z "$status" ]; then
  echo "no deployment yet for $sha (deployment $id has no status)" >&2
  exit 1
fi
read -r state url <<< "$status"

echo "commit:      $sha"
echo "state:       $state"
echo "environment: $environment"
echo "url:         $url"
