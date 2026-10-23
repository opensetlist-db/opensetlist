Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-AbsoluteTaskPath([string]$Path) {
    if ($Path -notmatch '^[A-Za-z]:[\\/]') { throw "Expected an absolute local drive path: $Path" }
    return [IO.Path]::GetFullPath($Path).TrimEnd('\')
}

function Test-SameTaskPath([string]$Left, [string]$Right) {
    return [string]::Equals($Left.TrimEnd('\').Replace('/', '\'), $Right.TrimEnd('\').Replace('/', '\'), [StringComparison]::OrdinalIgnoreCase)
}

function Assert-NoTaskReparseAncestor([string]$Path) {
    $cursor = $Path
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            $item = Get-Item -LiteralPath $cursor -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Reparse ancestor is not allowed: $cursor" }
        }
        $cursor = [IO.Path]::GetDirectoryName($cursor)
    }
}

function Invoke-TaskGit([string]$Root, [string[]]$Arguments) {
    # Native stderr is diagnostic data, never PowerShell source. Temporarily
    # relax PS 5.1's native-stderr promotion, then require the actual exit code.
    $saved = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $lines = @(& git.exe -C $Root @Arguments 2>&1)
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $saved }
    return @{ Code = $code; Text = ($lines | ForEach-Object { "$_" }) -join "`n" }
}

function Get-TaskGitText([string]$Root, [string[]]$Arguments) {
    $result = Invoke-TaskGit $Root $Arguments
    if ($result.Code -ne 0) { throw "git $($Arguments -join ' '): $($result.Text)" }
    return $result.Text.Trim()
}

function Get-TaskWorktrees([string]$Root) {
    # core.quotePath=false keeps non-ASCII paths intact. Windows filenames cannot
    # contain LF, so line records are unambiguous here (unlike a POSIX filename).
    $raw = Get-TaskGitText $Root @('-c', 'core.quotePath=false', 'worktree', 'list', '--porcelain')
    foreach ($record in ($raw -split "`n`n")) {
        $entry = @{ Path = ''; Branch = ''; Head = ''; Locked = $false }
        foreach ($line in ($record -split "`n")) {
            if ($line.StartsWith('worktree ')) { $entry.Path = Get-AbsoluteTaskPath $line.Substring(9) }
            elseif ($line.StartsWith('branch refs/heads/')) { $entry.Branch = $line.Substring(18) }
            elseif ($line.StartsWith('HEAD ')) { $entry.Head = $line.Substring(5) }
            elseif ($line -match '^locked($| )') { $entry.Locked = $true }
        }
        if ($entry.Path) { $entry }
    }
}

function Get-TaskInventory([string]$Root) {
    # Enumerate one level at a time. Never enqueue a reparse directory, including
    # dangling junctions and Next's nested package junctions.
    $stack = New-Object 'Collections.Generic.Stack[string]'
    $stack.Push($Root)
    while ($stack.Count) {
        $directory = $stack.Pop()
        Assert-NoTaskReparseAncestor $directory
        foreach ($item in ([IO.DirectoryInfo]::new($directory).EnumerateFileSystemInfos())) {
            if (-not $item.FullName.StartsWith($Root + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Enumeration escaped the worktree' }
            $item
            if (($item.Attributes -band [IO.FileAttributes]::Directory) -and -not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
                $stack.Push($item.FullName)
            }
        }
    }
}

function Remove-TaskLink([IO.FileSystemInfo]$Item) {
    if (-not ($Item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Not a link: $($Item.FullName)" }
    Assert-NoTaskReparseAncestor ([IO.Path]::GetDirectoryName($Item.FullName))
    # No recursive Remove-Item, cmd/rmdir, MSYS find, or cross-shell path lists.
    # DirectoryInfo.Delete(false) removes a junction itself, not its target.
    if ($Item.Attributes -band [IO.FileAttributes]::Directory) { [IO.Directory]::Delete($Item.FullName, $false) }
    else { [IO.File]::Delete($Item.FullName) }
    if (@(([IO.DirectoryInfo]::new([IO.Path]::GetDirectoryName($Item.FullName))).EnumerateFileSystemInfos() | Where-Object FullName -EQ $Item.FullName).Count) {
        throw "Link survived unlink: $($Item.FullName)"
    }
}

function Get-TaskProcesses {
    return @(Get-CimInstance Win32_Process -ErrorAction Stop)
}

function Assert-TaskInactive([string]$Path, [object[]]$Processes) {
    $here = Get-AbsoluteTaskPath (Get-Location).Path
    if ((Test-SameTaskPath $here $Path) -or $here.StartsWith($Path + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Active worktree: current directory is inside it' }
    $ancestors = @{}
    $current = $PID
    while ($current -and -not $ancestors.ContainsKey($current)) {
        $ancestors[$current] = $true
        $process = $Processes | Where-Object ProcessId -EQ $current | Select-Object -First 1
        if (-not $process) { break }
        $parentProcess = $Processes | Where-Object ProcessId -EQ $process.ParentProcessId | Select-Object -First 1
        if ($parentProcess -and $parentProcess.CreationDate -gt $process.CreationDate) { break }
        $current = [int]$process.ParentProcessId
    }
    foreach ($process in $Processes) {
        if ($ancestors.ContainsKey([int]$process.ProcessId)) { continue }
        $command = ([string]$process.CommandLine).Replace('/', '\')
        if ($command.IndexOf($Path, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
            throw "Active worktree: process $($process.ProcessId) references it"
        }
    }
}

Export-ModuleMember -Function *-Task*, Get-AbsoluteTaskPath, Test-SameTaskPath, Assert-NoTaskReparseAncestor
