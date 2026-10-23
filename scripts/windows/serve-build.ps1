[CmdletBinding()]
param([Parameter(Mandatory=$true)][ValidateRange(1,65535)][int]$Port, [switch]$NoBuild, [switch]$Stop)
Import-Module (Join-Path $PSScriptRoot 'task-common.psm1') -Force -DisableNameChecking
$ErrorActionPreference = 'Stop'
$serverMutex=$null
$ownsServerMutex=$false

function Get-PortHolders {
    # A Bound socket can prevent listen() just as a listener can. Never select
    # only the first holder: IPv4 and IPv6 may belong to different processes.
    return @(Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | Where-Object { $_.State -in @('Listen','Bound') } | Select-Object -ExpandProperty OwningProcess -Unique)
}

function Get-OwnedServer($Receipt) {
    if (-not $Receipt -or $Receipt.port -ne $Port -or -not (Test-SameTaskPath $Receipt.root $root)) { return $null }
    try {
        $process = [Diagnostics.Process]::GetProcessById([int]$Receipt.pid)
        # Pin the process handle before inspecting creation time. A subsequent
        # PID reuse cannot turn this handle into a different process.
        $null = $process.Handle
        $command = Get-CimInstance Win32_Process -Filter "ProcessId=$($process.Id)" -ErrorAction Stop
        $line = ([string]$command.CommandLine).Replace('/', '\')
        $pattern = '^\s*"?' + [regex]::Escape(([string]$command.ExecutablePath).Replace('/','\')) + '"?\s+"?' + [regex]::Escape($nextBin.Replace('/','\')) + '"?\s+start\s+-p\s+' + $Port + '\s*$'
        if (-not $command.ExecutablePath -or $process.ProcessName -ne 'node' -or $process.StartTime.ToUniversalTime().Ticks.ToString() -ne [string]$Receipt.startTicks -or -not [regex]::IsMatch($line,$pattern,[Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
            $process.Dispose(); return $null
        }
        return $process
    } catch { return $null }
}

try {
    if ($env:OS -ne 'Windows_NT') { throw 'Native Windows helper only' }
    $serverMutex=[Threading.Mutex]::new($false,"Local\OpenSetlistServe-$Port")
    $ownsServerMutex=$serverMutex.WaitOne(0)
    if (-not $ownsServerMutex) { throw "Another native serve-build operation owns port $Port" }
    $root = Get-AbsoluteTaskPath (Get-TaskGitText (Get-Location).Path @('rev-parse','--show-toplevel'))
    $gitDir = Get-AbsoluteTaskPath (Get-TaskGitText $root @('rev-parse','--absolute-git-dir'))
    $nextBin = Join-Path $root 'node_modules/next/dist/bin/next'
    $stateFile = Join-Path $gitDir "serve-build-windows-$Port.json"
    $pidFile = Join-Path $gitDir "serve-build-windows-$Port.pid"
    $logFile = Join-Path $gitDir "serve-build-windows-$Port.log"
    $receipt = if (Test-Path -LiteralPath $stateFile) { Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json } else { $null }
    $owned = Get-OwnedServer $receipt
    $holders = @(Get-PortHolders)
    foreach ($holder in $holders) {
        if (-not $owned -or $holder -ne $owned.Id) { throw "Port $Port is held by unverified PID $holder; choose another port. Legacy PID files alone do not authorize termination." }
    }
    if ($owned) {
        try {
            $owned.Kill()
            if (-not $owned.WaitForExit(10000)) { throw 'Owned server did not exit in 10s' }
            Write-Output "stopped verified server pid $($owned.Id)"
        } finally { $owned.Dispose() }
    }
    foreach ($file in @($stateFile,$pidFile)) { if (Test-Path -LiteralPath $file) { [IO.File]::Delete($file) } }
    if ($Stop) { Write-Output "no remaining owned server on :$Port"; exit 0 }
    if (-not (Test-Path -LiteralPath $nextBin -PathType Leaf)) { throw "Missing Next CLI: $nextBin. Check worktree dependencies before building." }
    $node = (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
    # Empty values are inherited by Node; Next's dotenv loader must not refill
    # them from .env files. Keep these set for both the build and detached start.
    $preload = (Join-Path $PSScriptRoot 'empty-sentry.cjs').Replace('\','/')
    $savedNodeOptions = $env:NODE_OPTIONS
    $env:NODE_OPTIONS = (($savedNodeOptions + ' --require="' + $preload + '"').Trim())
    if (-not $NoBuild) {
        $npm = (Get-Command npm.cmd -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
        Push-Location $root
        try { & $npm run build; if ($LASTEXITCODE -ne 0) { throw "Build failed (exit $LASTEXITCODE)" } }
        finally { Pop-Location }
    }
    if (@(Get-PortHolders).Count) { throw "Port $Port was taken during the build; no process was stopped" }
    $launcherPath=Join-Path $PSScriptRoot 'start-server.mjs'
    # ShellExecute (no redirected handles) prevents inheriting *additional*
    # ancestor capture-pipe handles. WaitForExit waits only for this launcher;
    # Start-Process -Wait would wait for its detached descendants as well.
    $launcher=Start-Process -FilePath $node -ArgumentList @(('"'+$launcherPath+'"'),('"'+$nextBin+'"'),"$Port",('"'+$root+'"'),('"'+$logFile+'"'),('"'+$pidFile+'"')) -WindowStyle Hidden -PassThru
    try {
        if (-not $launcher.WaitForExit(10000) -or $launcher.ExitCode -ne 0) { throw "Server launch failed; see $logFile.err" }
    } finally { $launcher.Dispose() }
    $server = [Diagnostics.Process]::GetProcessById([int]([IO.File]::ReadAllText($pidFile)))
    try {
        $null = $server.Handle
        @{ schemaVersion=1; pid=$server.Id; startTicks=$server.StartTime.ToUniversalTime().Ticks.ToString(); port=$Port; root=$root } | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8
        [IO.File]::WriteAllText($pidFile, $server.Id.ToString())
        $watch = [Diagnostics.Stopwatch]::StartNew()
        while ($watch.Elapsed.TotalSeconds -lt 120) {
            if ($server.HasExited) { throw "Server exited; see $logFile and $logFile.err" }
            try {
                $request = [Net.HttpWebRequest]::Create("http://127.0.0.1:$Port/robots.txt")
                $request.Proxy = $null
                $request.Timeout = 2000
                $request.AllowAutoRedirect = $false
                $response = $request.GetResponse()
                try { $statusCode = [int]$response.StatusCode } finally { $response.Dispose() }
                if ($statusCode -eq 200) {
                    # A foreign response must not become this checkout's ready.
                    $holders = @(Get-PortHolders)
                    if ($holders.Count -eq 1 -and $holders[0] -eq $server.Id) {
                        Write-Output "ready: http://localhost:$Port (/robots.txt 200, pid $($server.Id), log $logFile)"
                        exit 0
                    }
                }
            } catch { if ($server.HasExited) { throw "Server exited; see $logFile and $logFile.err" } }
            Start-Sleep -Milliseconds 500
        }
        throw "No verified /robots.txt 200 in 120s; server left running, stop with the same runtime and port. Log: $logFile"
    } finally { $server.Dispose() }
} catch { Write-Error $_ -ErrorAction Continue; exit 1 }
finally {
    if (Test-Path variable:savedNodeOptions) { $env:NODE_OPTIONS=$savedNodeOptions }
    if ($ownsServerMutex) { $serverMutex.ReleaseMutex() }
    if ($serverMutex) { $serverMutex.Dispose() }
}
