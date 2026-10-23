# Windows task runtime

Run these commands from the checkout being served, or from a surviving checkout
when removing a completed task. The scripts may live in another checkout.
Windows PowerShell 5.1 and PowerShell 7 are supported; Git for Windows and Node
must be on PATH. No package installation or machine configuration is performed.

## Select the runtime explicitly

```powershell
# Git Bash is resolved next to git.exe, never by a bare bash.exe on PATH.
powershell -NoProfile -File scripts/task-runtime.ps1 serve-build -Runtime GitBash -Port 3191
powershell -NoProfile -File scripts/task-runtime.ps1 serve-build -Runtime GitBash -Port 3191 -NoBuild
powershell -NoProfile -File scripts/task-runtime.ps1 serve-build -Runtime GitBash -Port 3191 -Stop

# WSL requires an explicit distribution and Linux node/npm/lsof/curl.
powershell -NoProfile -File scripts/task-runtime.ps1 serve-build -Runtime WSL -Distro Ubuntu -Port 3192
```

The Git Bash route delegates Windows serving to the native helper. A WSL
distribution uses the existing Linux implementation and its own Linux processes;
start and stop with the same runtime, distribution, checkout, and port. Missing
runtime prerequisites fail explicitly. Runtime switching on a live port is not
supported. Linux/macOS callers continue to use `bash scripts/serve-build.sh`.

The native helper blanks Sentry inside Node before dotenv loading, builds via
the existing npm script, and starts a hidden detached process. Its worktree Git
directory stores `serve-build-windows-<port>` logs, a `.pid` file, and a `.json` receipt with
checkout, port, PID, and process creation ticks. Stopping requires all of them to
match the exact Next CLI invocation. A pinned process handle prevents PID reuse
from selecting another process. Every Listen/Bound holder must match; a foreign
holder or a legacy PID file without a valid receipt is preserved and refused.
For an old server, use its original tool to stop it after verifying ownership.
Native Windows and WSL use separate receipt namespaces; a native per-port mutex
serializes concurrent start/stop operations. The hidden launcher avoids leaking
ancestor capture pipes into the server, including from PowerShell 5.1 callers.

## Remove a released worktree

Close its session/server first and obtain the full HEAD from its handoff. Run
from outside the target. `-ReleasedHead` confirms that session has relinquished
the exact checkout; it does not override any safety check. Git locks and
processes whose command lines reference the path also block removal. A shell
holding a directory without naming it in its command line cannot be discovered
reliably; the explicit session release remains required.

```powershell
$task = 'D:\projects\app\.claude\worktrees\completed-task'
$released = '0123456789abcdef0123456789abcdef01234567' # actual full handoff HEAD
powershell -NoProfile -File scripts/task-runtime.ps1 worktree-rm -Path $task -ReleasedHead $released -MergeRef origin/dev -DryRun
powershell -NoProfile -File scripts/task-runtime.ps1 worktree-rm -Path $task -ReleasedHead $released -MergeRef origin/dev
powershell -NoProfile -File scripts/task-runtime.ps1 worktree-rm -Sweep -DryRun
```

Fetch the intended merge ref before using it. `-MergeRef` accepts only the
project integration refs `origin/dev`, `origin/main`, and `origin/feature/redesign`.
Removal requires HEAD to be its
ancestor; squash merges without ancestry are deliberately refused. Branches are
always retained so their later deletion is a separate owner action. Sweep only
tries unregistered empty leftovers and reports registered worktrees as active.
Neither the Windows CLI nor its Git Bash adapter accepts a force bypass.

The helper requires an absolute local drive path directly inside the main
checkout's `.claude/worktrees`. It rejects a junction/symlink at the target or
any ancestor. Archive boundaries also use resolved file-handle paths, so subst
drive aliases cannot point the preserved copy back into the deleted worktree.
Long paths are expanded before comparison, so 8.3 aliases cannot
make an archive inside the target appear external. Git output is decoded as
UTF-8, including non-ASCII checkout paths and evidence filenames. It refuses
dirty/untracked, detached, Git-locked (including administrative lock files), active, and
unmerged worktrees. Hidden assume-unchanged/skip-worktree index flags are refused,
and merge checks use fully qualified remote refs to avoid local ref shadows.
Dependency junctions are removed first, followed by all
nested reparse points, with native .NET nonrecursive unlinking and verification.
Only junctions and symbolic links are eligible for unlinking; other reparse types
(such as cloud placeholder files) are refused. Only then may Git remove the
worktree. There is no cross-shell deletion or
global `worktree prune`. A nonempty unregistered leftover is preserved for
inspection; an empty folder held by Windows can be retried after release.

### Preserve raw evidence before removal

Archive source evidence outside the deleted directory before cleanup. Ignored
files other than `node_modules/`, `.next/`, `src/generated/`, `.env`, `.env.local`,
and owner-local instruction copies require a manifest. These exclusions are
disposable build/dependency files or worktree copies of checkout configuration;
keep any irreplaceable material out of them. Tracked/untracked changes must be
committed or moved out first. An archive manifest contains one entry per ignored
evidence file, using Git's relative forward-slash path and an absolute preserved
copy path:

```json
{"files":[{"path":".claude/tmp/raw/results.json","archivePath":"D:\\archives\\task\\results.json","sha256":"<SHA256>"}]}
```

Pass `-ArchiveManifest D:\archives\task\manifest.json`. Source and archived copy
must both match the recorded SHA256. The manifest and preserved copy must live
outside the target, with no reparse point at either path or any ancestor.
Dry-run performs the same preservation checks without
unlinking. Existing archives are read-only inputs, never rewritten by cleanup.

### Machine-readable result

One JSON object is written on stdout (or one sweep object containing `entries`).
`registration` (`registered`, `absent`, `unknown`), `folder` (`present`, `absent`,
`partial`, `empty-locked`, `unknown`), `branchPreserved`, `unlinked`, and
`sharedDependencies` are independent fields. Shared package manifests present
before the run are SHA256-checked afterwards. `no-sentinels` means no dependency
preservation claim is available. The command never deletes the branch.

| Exit | Meaning |
| --- | --- |
| 0 | Removed/already absent, validated dry-run, or sweep without refusals |
| 1 | Safety refusal or validation/unlink failure; inspect `reason` and states |
| 2 | Git registration absent, empty folder still held by Windows |
| 3 | Shared dependency sentinel changed or disappeared; stop cleanup |
| 4 | Git unregistered the target but nonempty files remain; inspect/preserve |

## Independent Windows fixture

```powershell
powershell -NoProfile -NonInteractive -File scripts/windows/runtime.test.ps1
```

The test creates its own temporary Git repo, worktrees, junction targets,
archive, directory handle lock, and a fake Next HTTP server. It tests actual
filesystem/process behavior without using app data, DB/R2, existing servers,
or other task worktrees. Failed fixtures remain for diagnosis. It requires
native CIM and TCP inspection privileges available to the current user; a
restricted environment that denies them cannot claim this suite passed.
