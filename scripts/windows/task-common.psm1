Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# A PS7 -> Git Bash -> powershell.exe call can inherit only PS7 module paths.
# Prefer this host's modules so PS5.1 resolves its own Get-FileHash/CIM cmdlets.
$env:PSModulePath=(Join-Path $PSHOME 'Modules') + [IO.Path]::PathSeparator + $env:PSModulePath

if (-not ('OpenSetlistRuntime.NativePath' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
namespace OpenSetlistRuntime {
  public static class NativePath {
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern uint GetLongPathNameW(string path, StringBuilder output, uint size);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern uint GetShortPathNameW(string path, StringBuilder output, uint size);
  }
}
'@
}

function Get-AbsoluteTaskPath([string]$Path) {
    if ($Path -notmatch '^[A-Za-z]:[\\/]') { throw "Expected an absolute local drive path: $Path" }
    $full=[IO.Path]::GetFullPath($Path).TrimEnd('\')
    $suffix=New-Object 'Collections.Generic.Stack[string]'
    $existing=$full
    while (-not (Test-Path -LiteralPath $existing)) {
        $suffix.Push([IO.Path]::GetFileName($existing))
        $existing=[IO.Path]::GetDirectoryName($existing)
        if (-not $existing) { throw "Cannot resolve path: $Path" }
    }
    $buffer=[Text.StringBuilder]::new(32768)
    $length=[OpenSetlistRuntime.NativePath]::GetLongPathNameW($existing,$buffer,32768)
    if ($length -eq 0 -or $length -ge 32768) { throw "Cannot expand the long Windows path: $existing" }
    $resolved=$buffer.ToString()
    if ($resolved -notmatch '^[A-Za-z]:\\$') { $resolved=$resolved.TrimEnd('\') }
    while ($suffix.Count) { $resolved=Join-Path $resolved $suffix.Pop() }
    return $resolved
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
    $savedConsoleEncoding=[Console]::OutputEncoding
    $savedOutputEncoding=$OutputEncoding
    try {
        [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
        $OutputEncoding=[Text.UTF8Encoding]::new($false)
        $ErrorActionPreference = 'Continue'
        $lines = @(& git.exe -C $Root @Arguments 2>&1)
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $saved; [Console]::OutputEncoding=$savedConsoleEncoding; $OutputEncoding=$savedOutputEncoding }
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
    Assert-TaskLinkType $Item
    Assert-NoTaskReparseAncestor ([IO.Path]::GetDirectoryName($Item.FullName))
    # No recursive Remove-Item, cmd/rmdir, MSYS find, or cross-shell path lists.
    # DirectoryInfo.Delete(false) removes a junction itself, not its target.
    if ($Item.Attributes -band [IO.FileAttributes]::Directory) { [IO.Directory]::Delete($Item.FullName, $false) }
    else { [IO.File]::Delete($Item.FullName) }
    if (@(([IO.DirectoryInfo]::new([IO.Path]::GetDirectoryName($Item.FullName))).EnumerateFileSystemInfos() | Where-Object FullName -EQ $Item.FullName).Count) {
        throw "Link survived unlink: $($Item.FullName)"
    }
}

function Assert-TaskLinkType([IO.FileSystemInfo]$Item) {
    $native=Get-Item -LiteralPath $Item.FullName -Force
    if ($native.LinkType -notin @('Junction','SymbolicLink')) { throw "Unsupported reparse point; preserve it manually: $($Item.FullName)" }
}

function Get-TaskProcesses {
    return @(Get-CimInstance Win32_Process -ErrorAction Stop)
}

function Assert-TaskGitUnlocked([string]$Root, [string]$Branch) {
    $gitDir=Get-AbsoluteTaskPath (Get-TaskGitText $Root @('rev-parse','--absolute-git-dir'))
    $common=Get-AbsoluteTaskPath (Get-TaskGitText $Root @('rev-parse','--path-format=absolute','--git-common-dir'))
    foreach ($directory in @($gitDir,$common) | Select-Object -Unique) {
        if (@(([IO.DirectoryInfo]::new($directory)).EnumerateFiles('*.lock')).Count) { throw 'Active Git operation: administrative lock file is present' }
    }
    if (Test-Path -LiteralPath (Join-Path $common "refs/heads/$Branch.lock")) { throw 'Active Git operation: branch ref is locked' }
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
