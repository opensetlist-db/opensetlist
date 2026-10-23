#!/usr/bin/env bash
# Production build + `next start` of the CURRENT checkout, for local
# browser QA (scripts/admin-qa.mjs, scripts/redesign-capture.mjs, …).
#
#   scripts/serve-build.sh <port>              build, then serve on <port>
#   scripts/serve-build.sh <port> --no-build   serve the existing .next
#   scripts/serve-build.sh --stop <port>       stop this checkout's server
#
# The checkout served is the one the CURRENT DIRECTORY is in (git
# toplevel), not the one this script lives in — so a branch that does not
# have this script yet can still be served by running it from a checkout
# that does: `bash <other-checkout>/scripts/serve-build.sh 3111`.
#
# Why a script instead of `npm run build && npx next start`:
#   - Sentry: the build and the server run with SENTRY_AUTH_TOKEN,
#     SENTRY_DSN and NEXT_PUBLIC_SENTRY_DSN set to the EMPTY string, so a
#     local build uploads nothing and local errors never reach Sentry.
#     Empty, not unset: Next's env loader fills a variable from .env only
#     when it is undefined, and an empty string counts as defined.
#   - Orphans: stopping a backgrounded `next start` (TaskStop, Ctrl-C of a
#     wrapping shell) leaves the node server listening on Windows, and a
#     stale server silently serves the OLD build. The server is therefore
#     started detached, its PID is recorded, and every later run (and
#     --stop) stops it again — but only after checking that the PID's
#     command line is `next start` from THIS checkout's node_modules.
#   - Collisions: a port held by anything else (another worktree's server,
#     another session's) is never touched; the script prints the holder
#     and exits 1 before spending minutes on a build.
#
# State lives in the checkout's own git dir (per worktree, never tracked):
#   <git-dir>/serve-build-<port>.pid       the recorded server PID
#   <git-dir>/serve-build-<port>.log(.err) the server's stdout / stderr
#
# Windows (Git Bash) uses PowerShell for port/process lookups
# (Get-NetTCPConnection, Win32_Process) and Start-Process for a detached
# server; elsewhere lsof/ps/nohup.
set -euo pipefail

# Git Bash is explicit at the Windows entry point. Process handles, receipts,
# port ownership and detached startup stay in one native implementation.
case "${OSTYPE:-}" in
  msys*|cygwin*)
    native="$(cygpath -w "$(dirname "${BASH_SOURCE[0]}")/windows/serve-build.ps1")"
    port=""; args=()
    for a in "$@"; do
      case "$a" in
        --stop) args+=(-Stop) ;;
        --no-build) args+=(-NoBuild) ;;
        *) [[ "$a" =~ ^[0-9]+$ ]] && [ -z "$port" ] || { echo 'expected one numeric port, --stop, --no-build' >&2; exit 2; }; port="$a" ;;
      esac
    done
    [ -n "$port" ] || { echo 'port required' >&2; exit 2; }
    # A detached child can inherit extra PowerShell pipe handles even when its
    # standard output/error are redirected. Give PowerShell file/null stdio as
    # well, otherwise a caller capturing this script waits until the server dies.
    control="$(git rev-parse --absolute-git-dir)/serve-build-$port.control.log"
    rc=0
    powershell.exe -NoProfile -NonInteractive -File "$native" -Port "$port" "${args[@]}" < /dev/null > "$control" 2>&1 || rc=$?
    cat "$control"
    exit "$rc"
    ;;
esac

usage() {
  echo "usage: serve-build.sh <port> [--no-build] | serve-build.sh --stop <port>" >&2
  exit 2
}

stop_only=0
build=1
port=""
for a in "$@"; do
  case "$a" in
    --stop) stop_only=1 ;;
    --no-build) build=0 ;;
    *) [[ "$a" =~ ^[0-9]+$ ]] && [ -z "$port" ] || usage; port="$a" ;;
  esac
done
[ -n "$port" ] || usage

root="$(git rev-parse --show-toplevel)"
gitdir="$(git rev-parse --absolute-git-dir)"
pidfile="$gitdir/serve-build-$port.pid"
logfile="$gitdir/serve-build-$port.log"
next_bin="$root/node_modules/next/dist/bin/next"

case "${OSTYPE:-}" in msys* | cygwin*) win=1 ;; *) win=0 ;; esac

ps1() { powershell -NoProfile -NonInteractive -Command "$1" | tr -d '\r'; }

# PID holding $port, or empty. On Windows a socket in state Bound (not
# Listen) blocks `listen` too: an orphaned Playwright
# WebKitNetworkProcess.exe was seen holding a QA port that way.
listener_pid() {
  if ((win)); then
    ps1 "(Get-NetTCPConnection -LocalPort $port -State Listen,Bound -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess"
  else
    lsof -nP -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -1 || true
  fi
}

# Full command line of a PID, or empty when it is gone.
cmdline() {
  if ((win)); then
    ps1 "(Get-CimInstance Win32_Process -Filter 'ProcessId=$1').CommandLine"
  else
    ps -o args= -p "$1" 2>/dev/null || true
  fi
}

# True when the PID is `next start` run from THIS checkout's node_modules.
# Matching `<root>/node_modules/` (not just `<root>`) matters: the main
# checkout's path is a prefix of every worktree path, so a bare prefix
# test would let the main checkout claim a worktree's server.
is_ours() {
  local cl want
  cl="$(cmdline "$1")"
  [ -n "$cl" ] || return 1
  if ((win)); then
    want="$(cygpath -w "$root")\\node_modules\\"
    cl="${cl//\//\\}"
  else
    want="$root/node_modules/"
  fi
  # tr, not ${x,,}: macOS ships bash 3.2.
  cl="$(printf '%s' "$cl" | tr '[:upper:]' '[:lower:]')"
  want="$(printf '%s' "$want" | tr '[:upper:]' '[:lower:]')"
  [[ "$cl" == *"$want"* && "$cl" =~ next.*start ]]
}

kill_tree() {
  if ((win)); then
    taskkill //PID "$1" //T //F > /dev/null 2>&1 || true
  else
    kill "$1" 2>/dev/null || true
  fi
}

# Stop the recorded server and any verified-ours listener on the port.
# Anything that fails the is_ours check is left alone — a recorded PID
# may have been reused by an unrelated process since.
stop_ours() {
  local pid stopped=0
  if [ -f "$pidfile" ]; then
    pid="$(cat "$pidfile")"
    if [ -n "$pid" ] && is_ours "$pid"; then
      kill_tree "$pid"
      echo "stopped recorded server pid $pid"
      stopped=1
    fi
    rm -f "$pidfile"
  fi
  pid="$(listener_pid)"
  if [ -n "$pid" ] && is_ours "$pid"; then
    kill_tree "$pid"
    echo "stopped unrecorded server of this checkout on :$port (pid $pid)"
    stopped=1
  fi
  for _ in $(seq 1 20); do
    [ -z "$(listener_pid)" ] && break
    sleep 0.5
  done
  ((stopped)) || echo "no server of this checkout on :$port"
}

refuse_foreign_holder() {
  local holder
  holder="$(listener_pid)"
  if [ -n "$holder" ] && ! is_ours "$holder"; then
    echo "port $port is held by pid $holder, which is not this checkout's next start:" >&2
    echo "  $(cmdline "$holder")" >&2
    echo "pick another port; this script never stops a process it did not start" >&2
    exit 1
  fi
}

refuse_foreign_holder
stop_ours
((stop_only)) && exit 0

[ -f "$next_bin" ] || { echo "missing $next_bin — run npm ci in $root" >&2; exit 1; }

export SENTRY_AUTH_TOKEN="" SENTRY_DSN="" NEXT_PUBLIC_SENTRY_DSN=""

if ((build)); then
  echo "building $root (Sentry variables blanked)…"
  (cd "$root" && npm run build)
  # The build takes minutes; something else may have taken the port since.
  refuse_foreign_holder
fi

: > "$logfile"
: > "$logfile.err"
if ((win)); then
  # Start-Process gives a process outside this shell's job, so it outlives
  # the calling tool, and returns its real Windows PID ($! in Git Bash is
  # an MSYS pid). The empty Sentry variables are inherited.
  # Start-Process lets the child inherit PowerShell's std handles, so the
  # PID goes to the pidfile and PowerShell's own stdio is /dev/null: a
  # `$(…)` capture would hand node the pipe and wait for it to close,
  # i.e. until the server exits.
  rm -f "$pidfile"
  powershell -NoProfile -NonInteractive -Command "\$p = Start-Process -FilePath node -ArgumentList '\"$(cygpath -w "$next_bin")\"','start','-p','$port' -WorkingDirectory '$(cygpath -w "$root")' -RedirectStandardOutput '$(cygpath -w "$logfile")' -RedirectStandardError '$(cygpath -w "$logfile.err")' -WindowStyle Hidden -PassThru; Set-Content -Path '$(cygpath -w "$pidfile")' -Value \$p.Id -NoNewline -Encoding ascii" < /dev/null > /dev/null 2>&1
  pid="$(cat "$pidfile" 2>/dev/null || true)"
  [ -n "$pid" ] || { echo "Start-Process did not report a PID" >&2; exit 1; }
else
  pid="$(cd "$root" && { nohup node "$next_bin" start -p "$port" > "$logfile" 2> "$logfile.err" < /dev/null & echo $!; })"
fi
echo "$pid" > "$pidfile"
echo "started next start pid $pid on :$port (log $logfile)"

# A wall-clock deadline: on Windows each liveness check below starts
# PowerShell, so counting iterations would understate the wait.
SECONDS=0
while ((SECONDS < 120)); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$port/robots.txt" || true)"
  if [ "$code" = "200" ]; then
    echo "ready: http://localhost:$port (/robots.txt 200 after ${SECONDS}s)"
    echo "stop: (cd $root && bash scripts/serve-build.sh --stop $port)"
    exit 0
  fi
  if [ -z "$(cmdline "$pid")" ]; then
    echo "server exited before answering; log:" >&2
    tail -n 30 "$logfile" "$logfile.err" >&2 2>/dev/null || true
    rm -f "$pidfile"
    exit 1
  fi
  sleep 1
done
echo "no 200 from /robots.txt within 120s; server left running (pid $pid), log:" >&2
tail -n 30 "$logfile" "$logfile.err" >&2 2>/dev/null || true
exit 1
