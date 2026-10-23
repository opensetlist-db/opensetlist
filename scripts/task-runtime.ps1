[CmdletBinding()]
param(
    [Parameter(Mandatory=$true,Position=0)][ValidateSet('serve-build','worktree-rm')][string]$Task,
    [ValidateSet('GitBash','WSL')][string]$Runtime,
    [string]$Distro,
    [ValidateRange(1,65535)][int]$Port,
    [switch]$NoBuild,
    [switch]$Stop,
    [string]$Path,
    [string]$MergeRef='origin/dev',
    [string]$ReleasedHead,
    [string]$ArchiveManifest,
    [switch]$DryRun,
    [switch]$Sweep
)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$OutputEncoding=[Text.UTF8Encoding]::new($false)
try {
    if ($env:OS -ne 'Windows_NT') { throw 'Use the .sh entry points on Linux/macOS' }
    if ($Task -eq 'worktree-rm') {
        if ($Runtime -or $Distro -or $Port -or $Stop -or $NoBuild) { throw 'worktree-rm always uses native PowerShell; runtime/serve options are not applicable' }
        & (Join-Path $PSScriptRoot 'worktree-rm.ps1') -Path $Path -MergeRef $MergeRef -ReleasedHead $ReleasedHead -ArchiveManifest $ArchiveManifest -DryRun:$DryRun -Sweep:$Sweep
        exit $LASTEXITCODE
    }
    if (-not $Runtime -or -not $Port) { throw 'serve-build requires -Runtime GitBash|WSL and -Port (no implicit bash.exe selection)' }
    if ($Path -or $ReleasedHead -or $ArchiveManifest -or $DryRun -or $Sweep) { throw 'Cleanup options are not applicable to serve-build' }
    $serveArgs = @("$Port")
    if ($NoBuild) { $serveArgs += '--no-build' }
    if ($Stop) { $serveArgs += '--stop' }
    $script = Join-Path $PSScriptRoot 'serve-build.sh'
    if ($Runtime -eq 'GitBash') {
        if ($Distro) { throw '-Distro is only valid with WSL' }
        $bash = $null
        foreach ($git in @(Get-Command git.exe -CommandType Application -ErrorAction Stop)) {
            $installation = Split-Path $git.Source -Parent
            # PATH may contain cmd/git.exe, bin/git.exe, or mingw64/bin/git.exe.
            # Search their ancestors rather than assuming a user's install path.
            while ($installation -and -not $bash) {
                foreach ($relative in @('bin/bash.exe','usr/bin/bash.exe')) {
                    $candidate=Join-Path $installation $relative
                    if (Test-Path -LiteralPath $candidate -PathType Leaf) { $bash=$candidate; break }
                }
                $installation=Split-Path $installation -Parent
            }
            if ($bash) { break }
        }
        if (-not $bash) { throw 'Cannot locate Git Bash next to git.exe; install Git for Windows with its Bash runtime on PATH' }
        & $bash -c 'case "$OSTYPE" in msys*|cygwin*) exit 0;; *) exit 1;; esac'
        if ($LASTEXITCODE -ne 0) { throw 'Resolved bash is not Git Bash' }
        & $bash $script @serveArgs
    } else {
        if (-not $Distro) { throw 'WSL requires an explicit -Distro; run wsl --list --quiet to select one' }
        $wsl = (Get-Command wsl.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
        $linuxScript = & $wsl --distribution $Distro --exec wslpath -a $script
        if ($LASTEXITCODE -ne 0 -or -not $linuxScript) { throw 'WSL distro or wslpath unavailable' }
        $linuxCwd = & $wsl --distribution $Distro --exec wslpath -a (Get-Location).Path
        if ($LASTEXITCODE -ne 0 -or -not $linuxCwd) { throw 'Cannot map the current checkout into WSL' }
        $checkScript = & $wsl --distribution $Distro --exec wslpath -a (Join-Path $PSScriptRoot 'windows/check-wsl-runtime.sh')
        if ($LASTEXITCODE -ne 0 -or -not $checkScript) { throw 'Cannot map the WSL prerequisite script' }
        & $wsl --distribution $Distro --cd $linuxCwd.Trim() --exec bash $checkScript.Trim()
        if ($LASTEXITCODE -ne 0) { throw 'WSL needs Linux node, npm, lsof and curl; Windows node.exe is not supported for this runtime' }
        & $wsl --distribution $Distro --cd $linuxCwd.Trim() --exec bash $linuxScript.Trim() @serveArgs
    }
    exit $LASTEXITCODE
} catch { Write-Error $_ -ErrorAction Continue; exit 1 }
