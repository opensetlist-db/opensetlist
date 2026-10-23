[CmdletBinding()]
param(
    [string]$Path,
    [string]$MergeRef = 'origin/dev',
    [string]$ReleasedHead,
    [string]$ArchiveManifest,
    [switch]$DryRun,
    [switch]$Sweep
)
Import-Module (Join-Path $PSScriptRoot 'windows/task-common.psm1') -Force -DisableNameChecking
$ErrorActionPreference = 'Stop'
if ($Sweep) {
    try {
        [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
        $OutputEncoding=[Text.UTF8Encoding]::new($false)
        if ($Path -or $ReleasedHead -or $ArchiveManifest) { throw 'Sweep accepts only -DryRun; release registered worktrees individually' }
        $trees = @(Get-TaskWorktrees (Get-Location).Path)
        $parent = Join-Path $trees[0].Path '.claude/worktrees'
        Assert-NoTaskReparseAncestor $parent
        $entries = @()
        if (Test-Path -LiteralPath $parent) {
            foreach ($item in ([IO.DirectoryInfo]::new($parent).EnumerateDirectories())) {
                if (@($trees | Where-Object { Test-SameTaskPath $_.Path $item.FullName }).Count) {
                    $entries += @{ path=$item.FullName; status='active'; reason='registered worktrees require individual exact-HEAD release' }
                } else {
                    $json = & $PSCommandPath -Path $item.FullName -DryRun:$DryRun
                    $entries += (($json -join "`n") | ConvertFrom-Json)
                }
            }
        }
        $failed = @($entries | Where-Object { $_.status -in @('refused','partial','dependency-error') }).Count
        @{ schemaVersion=1; status='sweep'; entries=$entries; exitCode=[int]($failed -gt 0) } | ConvertTo-Json -Depth 8
        exit [int]($failed -gt 0)
    } catch { @{schemaVersion=1;status='refused';reason=$_.Exception.Message;exitCode=1} | ConvertTo-Json; exit 1 }
}
$result = [ordered]@{ schemaVersion=1; path=$Path; status='refused'; reason=''; registration='unknown'; folder='unknown'; branch=''; branchPreserved=$true; unlinked=0; sharedDependencies='unchecked'; dryRun=[bool]$DryRun; exitCode=1 }
$sentinels = @{}
$mutex = $null
$ownsMutex = $false
try {
    [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
    $OutputEncoding=[Text.UTF8Encoding]::new($false)
    if ($env:OS -ne 'Windows_NT') { throw 'This helper requires native Windows PowerShell; use worktree-rm.sh on Linux/macOS' }
    $target = Get-AbsoluteTaskPath $Path
    $result.path = $target
    $trees = @(Get-TaskWorktrees (Get-Location).Path)
    $main = $trees[0].Path
    $parent = Join-Path $main '.claude/worktrees'
    if (-not (Test-SameTaskPath ([IO.Path]::GetDirectoryName($target)) $parent)) { throw 'Target must be a direct child of the main checkout .claude/worktrees directory' }
    Assert-NoTaskReparseAncestor $target
    $hash = [Security.Cryptography.SHA256]::Create()
    try { $key = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($target.ToLowerInvariant()))).Replace('-', '') }
    finally { $hash.Dispose() }
    $mutex = [Threading.Mutex]::new($false, "Local\OpenSetlistCleanup-$key")
    $ownsMutex = $mutex.WaitOne(0)
    if (-not $ownsMutex) { throw 'Another cleanup owns this worktree' }
    $tree = $trees | Where-Object { Test-SameTaskPath $_.Path $target } | Select-Object -First 1
    $result.registration = if ($tree) { 'registered' } else { 'absent' }
    $result.folder = if (Test-Path -LiteralPath $target) { 'present' } else { 'absent' }
    if ($tree) {
        $result.branch = $tree.Branch
        if ($tree.Locked) { throw 'Active worktree: Git worktree lock is set' }
        if (-not $tree.Branch) { throw 'Detached HEAD is not eligible for cleanup' }
        if ($ReleasedHead -notmatch '^[0-9a-fA-F]{40}$' -or $ReleasedHead -ne $tree.Head) { throw 'Active until explicitly released: pass -ReleasedHead with the exact full HEAD from its completed session handoff' }
        if (-not (Test-Path -LiteralPath $target -PathType Container)) { throw 'Registered worktree folder is missing; inspect its Git metadata manually' }
        if (-not (Test-Path -LiteralPath (Join-Path $target '.git') -PathType Leaf)) { throw 'Broken registration: target .git file is missing' }
        Assert-NoTaskReparseAncestor (Join-Path $target '.git')
        if (-not (Test-SameTaskPath (Get-TaskGitText $target @('rev-parse','--show-toplevel')) $target) -or (Get-TaskGitText $target @('rev-parse','HEAD')) -ne $tree.Head) { throw 'Target no longer matches its Git registration' }
        $targetCommon=Get-AbsoluteTaskPath (Get-TaskGitText $target @('rev-parse','--path-format=absolute','--git-common-dir'))
        $mainCommon=Get-AbsoluteTaskPath (Get-TaskGitText $main @('rev-parse','--path-format=absolute','--git-common-dir'))
        if (-not (Test-SameTaskPath $targetCommon $mainCommon)) { throw 'Target .git points to another repository' }
        if ((Get-TaskGitText $target @('symbolic-ref','--short','HEAD')) -ne $tree.Branch) { throw 'Target branch differs from its registration' }
        Assert-TaskGitUnlocked $target $tree.Branch
        Assert-TaskInactive $target (Get-TaskProcesses)
        $status = Get-TaskGitText $target @('status', '--porcelain', '--untracked-files=all')
        if ($status) { throw 'Dirty worktree: commit or preserve every tracked/untracked change first' }
        if ((Get-TaskGitText $target @('ls-files','-v')) -match '(?m)^[a-zS] ') { throw 'Hidden index flags (assume-unchanged/skip-worktree) must be cleared before cleanup' }
        if ($MergeRef -notin @('origin/dev','origin/main','origin/feature/redesign')) { throw 'MergeRef must name a project remote integration branch: origin/dev, origin/main, origin/feature/redesign' }
        $merged = Invoke-TaskGit $main @('merge-base', '--is-ancestor', $tree.Head, "refs/remotes/$MergeRef")
        if ($merged.Code -ne 0) { throw "Unmerged HEAD (or invalid merge ref): $MergeRef" }
    } elseif (Test-Path -LiteralPath $target) {
        # A previous partial removal may leave a locked empty folder. No stale
        # release flag grants permission to delete nonempty unregistered data.
        Assert-TaskInactive $target (Get-TaskProcesses)
        if (@(([IO.DirectoryInfo]::new($target)).EnumerateFileSystemInfos()).Count) { throw 'Unregistered folder is nonempty; preserve and inspect it manually' }
    }
    foreach ($package in @('next', '@prisma/client', 'pg', 'kuromoji')) {
        $file = Join-Path $main "node_modules/$package/package.json"
        if (Test-Path -LiteralPath $file) { $sentinels[$file] = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash }
    }
    $result.sharedDependencies = if ($sentinels.Count) { 'snapshotted' } else { 'no-sentinels' }
    if ($tree) {
        # Only explicitly disposable local files may disappear without an
        # archive. Unknown ignored artifacts (screenshots, raw traces, scratchpad)
        # need an external manifest proving source AND preserved copy hashes.
        $inventory = @(Get-TaskInventory $target)
        $tracked = Get-TaskGitText $target @('-c', 'core.quotePath=false', 'ls-files')
        $trackedPaths = @($tracked -split "`n" | Where-Object { $_ })
        $proof = $null
        if ($ArchiveManifest) {
            $manifestPath = Get-AbsoluteTaskPath $ArchiveManifest
            Assert-NoTaskReparseAncestor $manifestPath
            Assert-TaskArchiveOutside $manifestPath $target
            if ((Test-SameTaskPath $manifestPath $target) -or $manifestPath.StartsWith($target + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Archive manifest must live outside the deleted worktree' }
            $proof = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
        }
        foreach ($item in $inventory) {
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { Assert-TaskLinkType $item; continue }
            if ($item.Attributes -band [IO.FileAttributes]::Directory) { continue }
            $relative = $item.FullName.Substring($target.Length + 1).Replace('\', '/')
            if ($relative -match '^(node_modules/|\.next/|src/generated/|\.git$|\.env(\.local)?$|AGENTS\.local\.md$|CLAUDE\.local\.md$)') { continue }
            # An unrecognised path requires proof. A decoding/matching failure
            # must never turn an ignored evidence file into permission to delete.
            if ($trackedPaths -ccontains $relative) { continue }
            $entry = @($proof.files | Where-Object path -CEQ $relative)
            if ($entry.Count -ne 1) { throw "Ignored evidence needs one verified archive entry: $relative" }
            $archive = Get-AbsoluteTaskPath $entry[0].archivePath
            Assert-NoTaskReparseAncestor $archive
            Assert-TaskArchiveOutside $archive $target
            if ($archive.StartsWith($target + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Archive copy must live outside the deleted worktree' }
            $sourceHash = (Get-FileHash -LiteralPath (Join-Path $target $relative) -Algorithm SHA256).Hash
            if ($sourceHash -ne $entry[0].sha256 -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $sourceHash) { throw "Archive hash mismatch: $relative" }
        }
        # Git must not see tracked symlinks removed as dirty files. Refuse them
        # before mutation; ignored build/dependency junctions are the usual case.
        foreach ($link in ($inventory | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })) {
            $relative = $link.FullName.Substring($target.Length + 1).Replace('\', '/')
            if (Get-TaskGitText $target @('ls-files', '--', $relative)) { throw "Tracked link requires manual preservation: $relative" }
        }
    }
    if ($DryRun) { $result.status='would-remove'; $result.exitCode=0 }
    else {
        if ($tree) {
            # Repeat state checks immediately before the first mutation. A release
            # SHA never overrides a newly dirty, locked, or active worktree.
            if ((Get-TaskGitText $target @('rev-parse', 'HEAD')) -ne $ReleasedHead -or (Get-TaskGitText $target @('status', '--porcelain', '--untracked-files=all'))) { throw 'Worktree changed during validation' }
            Assert-TaskInactive $target (Get-TaskProcesses)
            Assert-TaskGitUnlocked $target $tree.Branch
            if ((Get-TaskGitText $target @('ls-files','-v')) -match '(?m)^[a-zS] ') { throw 'Hidden index flags appeared during validation' }
            if (@(Get-TaskWorktrees $main | Where-Object { (Test-SameTaskPath $_.Path $target) -and $_.Locked }).Count) { throw 'Worktree became Git-locked' }
            # Unlink the dependency root first, then every nested build junction.
            $links = @($inventory | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint } | Sort-Object @{Expression={ if (Test-SameTaskPath $_.FullName (Join-Path $target 'node_modules')) { 0 } else { 1 } }})
            foreach ($link in $links) { Remove-TaskLink $link; $result.unlinked++ }
            if (@(Get-TaskInventory $target | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) { throw 'A link appeared during cleanup; stopping before Git deletion' }
            $removal = Invoke-TaskGit $main @('worktree', 'remove', $target)
            $remaining = @(Get-TaskWorktrees $main | Where-Object { Test-SameTaskPath $_.Path $target })
            $result.registration = if ($remaining.Count) { 'registered' } else { 'absent' }
            if ($remaining.Count) {
                $result.folder=if (-not (Test-Path -LiteralPath $target)) { 'absent' } elseif (-not (Test-Path -LiteralPath (Join-Path $target '.git'))) { 'partial' } elseif ((Invoke-TaskGit $target @('status','--porcelain','--untracked-files=all')).Text) { 'partial' } else { 'present' }
                throw "Git refused removal; branch and registration retained; inspect folder state and relink dependencies before reuse. $($removal.Text)"
            }
        }
        if (Test-Path -LiteralPath $target) {
            Assert-NoTaskReparseAncestor $target
            $remainingItems = @(([IO.DirectoryInfo]::new($target)).EnumerateFileSystemInfos())
            if ($remainingItems.Count) {
                $result.folder='partial'; $result.status='partial'; $result.exitCode=4
                $result.reason='Git unregistered the worktree but files remain; preserve/inspect them, no recursive fallback'
            } else {
                try { [IO.Directory]::Delete($target, $false); $result.folder='absent' }
                catch { $result.folder='empty-locked'; $result.status='locked'; $result.exitCode=2; $result.reason=$_.Exception.Message }
            }
        } else { $result.folder='absent' }
        if ($result.folder -eq 'absent') { $result.status='removed'; $result.exitCode=0 }
    }
} catch { $result.reason=$_.Exception.Message }
finally {
    foreach ($file in $sentinels.Keys) {
        try {
            if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $sentinels[$file]) { throw "Shared dependency changed: $file" }
            $result.sharedDependencies='same-sha256'
        } catch { $result.sharedDependencies='changed'; $result.status='dependency-error'; $result.reason=$_.Exception.Message; $result.exitCode=3; break }
    }
    if ($ownsMutex) { $mutex.ReleaseMutex() }
    if ($mutex) { $mutex.Dispose() }
}
$result | ConvertTo-Json -Depth 6
exit $result.exitCode
