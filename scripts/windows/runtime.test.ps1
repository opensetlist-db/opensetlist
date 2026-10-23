[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$OutputEncoding=[Text.UTF8Encoding]::new($false)
Import-Module (Join-Path $PSScriptRoot 'task-common.psm1') -Force -DisableNameChecking
if ($env:OS -ne 'Windows_NT') { throw 'Windows fixtures require actual Windows junctions and processes' }
$shell = (Get-Process -Id $PID).Path
$repoScripts = Split-Path $PSScriptRoot -Parent
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('opensetlist runtime ' + [guid]::NewGuid().ToString('N') + ' ' + [char]0xD55C + [char]0xAE00)
$repo = Join-Path $fixture 'repo'
$checks = 0
$children = New-Object 'Collections.Generic.List[Diagnostics.Process]'

function Assert($Condition, [string]$Message) {
    if (-not $Condition) { throw "FAIL: $Message (fixture retained at $fixture)" }
    $script:checks++
    Write-Output "PASS: $Message"
}
function Git([string]$Root, [string[]]$Arguments) { $null=Get-TaskGitText $Root $Arguments }
function New-Tree([string]$Name) {
    $path = Join-Path $repo ".claude/worktrees/$Name"
    Git $repo @('worktree','add','-b',"task/$Name",$path,'origin/dev')
    return $path
}
function Run-Remove([string]$Target, [string[]]$Extra=@()) {
    $output = & $shell -NoProfile -NonInteractive -File (Join-Path $repoScripts 'worktree-rm.ps1') -Path $Target @Extra
    $code = $LASTEXITCODE
    $parsed = ($output -join "`n") | ConvertFrom-Json
    if ($parsed.exitCode -ne $code) { throw 'JSON exit code does not match process status' }
    return $parsed
}
function Run-Serve([int]$ServePort, [string[]]$Extra=@()) {
    $saved=$ErrorActionPreference
    try {
        $ErrorActionPreference='Continue'
        $output = & $shell -NoProfile -NonInteractive -File (Join-Path $repoScripts 'task-runtime.ps1') serve-build -Runtime GitBash -Port $ServePort @Extra 2>&1
        return @{ code=$LASTEXITCODE; text=(($output -join "`n") -replace '\s+',' ') }
    } finally { $ErrorActionPreference=$saved }
}
function Free-Port {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
    $listener.Start()
    $value = $listener.LocalEndpoint.Port
    $listener.Stop()
    return $value
}
function Write-Receipt($Receipt, [string]$File) { $Receipt | ConvertTo-Json | Set-Content -LiteralPath $File -Encoding UTF8 }

New-Item -ItemType Directory -Path $repo -Force | Out-Null
Git $repo @('init','--initial-branch=dev')
Git $repo @('config','user.name','Runtime Fixture')
Git $repo @('config','user.email','runtime@example.invalid')
$unicodeName=[string][char]0x8A3C + [char]0x62E0 + '.json'
[IO.File]::WriteAllText((Join-Path $repo '.gitignore'), "node_modules/`n.next/`n.claude/`nraw/`n.env.local`n$unicodeName`n")
[IO.File]::WriteAllText((Join-Path $repo 'tracked.txt'), 'tracked fixture')
Git $repo @('add','.gitignore','tracked.txt')
Git $repo @('commit','-m','fixture baseline')
Git $repo @('update-ref','refs/remotes/origin/dev','HEAD')
$tip = Get-TaskGitText $repo @('rev-parse','HEAD')
Push-Location $repo
$success=$false
try {
    $outside = Join-Path $fixture 'outside'
    New-Item -ItemType Directory -Path $outside -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $outside 'sentinel'), 'outside must survive')
    Assert ((Run-Remove $outside).exitCode -eq 1) 'outside target refused'
    Assert ((Run-Remove '.claude/worktrees/relative').exitCode -eq 1) 'relative target refused'
    Assert ((Run-Remove (Join-Path $repo '.claude/worktrees/nested/child')).exitCode -eq 1) 'nested target refused'
    $clean = New-Tree 'clean'
    Assert ((Run-Remove $clean).reason -match 'Active until') 'fresh clean worktree requires an exact release HEAD'
    Assert ((Run-Remove $clean @('-ReleasedHead',('0'*40))).exitCode -eq 1) 'stale release HEAD refused'
    Git $repo @('worktree','lock',$clean)
    Assert ((Run-Remove $clean @('-ReleasedHead',$tip)).reason -match 'lock') 'Git-locked worktree refused'
    Git $repo @('worktree','unlock',$clean)
    $indexLock=Join-Path (Get-TaskGitText $clean @('rev-parse','--absolute-git-dir')) 'index.lock'
    [IO.File]::WriteAllText($indexLock,'active fixture Git operation')
    Assert ((Run-Remove $clean @('-ReleasedHead',$tip)).reason -match 'administrative lock') 'Git administrative lock blocks cleanup'
    [IO.File]::Delete($indexLock)
    Assert ((Run-Remove $clean @('-ReleasedHead',$tip,'-MergeRef','task/clean')).reason -match 'remote integration') 'own branch cannot bypass the merge guard'
    $gitControl=Join-Path $clean '.git'
    $gitControlText=[IO.File]::ReadAllText($gitControl)
    [IO.File]::Delete($gitControl)
    Assert ((Run-Remove $clean @('-ReleasedHead',$tip,'-DryRun')).reason -match 'Broken registration') 'missing worktree .git cannot fall back to the main repository'
    [IO.File]::WriteAllText($gitControl,$gitControlText)
    Push-Location $clean
    try { Assert ((Run-Remove $clean @('-ReleasedHead',$tip)).reason -match 'current directory') 'current worktree refused' }
    finally { Pop-Location }
    Git $clean @('config','status.showUntrackedFiles','no')
    [IO.File]::WriteAllText((Join-Path $clean 'untracked'), 'must survive')
    Assert ((Run-Remove $clean @('-ReleasedHead',$tip)).reason -match 'Dirty') 'untracked files refused even when Git status config hides them'
    Assert (Test-Path -LiteralPath (Join-Path $clean 'untracked')) 'dirty refusal preserves user file'
    [IO.File]::Delete((Join-Path $clean 'untracked'))
    Git $clean @('update-index','--assume-unchanged','tracked.txt')
    [IO.File]::WriteAllText((Join-Path $clean 'tracked.txt'),'hidden local change')
    Assert (-not (Get-TaskGitText $clean @('status','--porcelain'))) 'assume-unchanged positive control actually hides a local edit'
    Assert ((Run-Remove $clean @('-ReleasedHead',$tip)).reason -match 'Hidden index flags') 'hidden tracked modification blocks cleanup'
    Assert ([IO.File]::ReadAllText((Join-Path $clean 'tracked.txt')) -eq 'hidden local change') 'hidden edit remains intact after refusal'
    Git $clean @('update-index','--no-assume-unchanged','tracked.txt')
    [IO.File]::WriteAllText((Join-Path $clean 'tracked.txt'),'tracked fixture')
    [IO.File]::WriteAllText((Join-Path $clean 'tracked.txt'), 'unmerged')
    Git $clean @('add','tracked.txt')
    Git $clean @('commit','-m','unmerged fixture')
    $unmerged = Get-TaskGitText $clean @('rev-parse','HEAD')
    Assert ((Run-Remove $clean @('-ReleasedHead',$unmerged)).reason -match 'Unmerged') 'unmerged HEAD refused'
    Git $repo @('update-ref','refs/heads/origin/dev',$unmerged)
    Assert ((Get-TaskGitText $repo @('rev-parse','refs/heads/origin/dev')) -eq $unmerged) 'local origin/dev shadow positive control points at unmerged HEAD'
    Assert ((Run-Remove $clean @('-ReleasedHead',$unmerged)).reason -match 'Unmerged') 'local ref shadow cannot bypass remote merge guard'
    Git $repo @('update-ref','-d','refs/heads/origin/dev')
    Assert ((Get-TaskGitText $repo @('rev-parse','task/clean')) -eq $unmerged) 'unmerged branch preserved'

    $linked = New-Tree 'linked'
    [IO.File]::WriteAllText((Join-Path $linked $unicodeName),'non-ASCII ignored evidence')
    Assert ((Run-Remove $linked @('-ReleasedHead',$tip)).reason -match 'archive entry') 'non-ASCII ignored filename requires archive proof under a non-ASCII checkout root'
    [IO.File]::Delete((Join-Path $linked $unicodeName))
    New-Item -ItemType Directory -Path (Join-Path $repo 'node_modules/next') -Force | Out-Null
    $sharedFile = Join-Path $repo 'node_modules/next/package.json'
    [IO.File]::WriteAllText($sharedFile, '{"name":"next","version":"0.0.0"}')
    $sharedHash = (Get-FileHash -LiteralPath $sharedFile).Hash
    New-Item -ItemType Junction -Path (Join-Path $linked 'node_modules') -Target (Join-Path $repo 'node_modules') | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $linked '.next/node_modules') -Force | Out-Null
    New-Item -ItemType Junction -Path (Join-Path $linked '.next/node_modules/package-link') -Target $outside | Out-Null
    Assert (Test-Path -LiteralPath (Join-Path $linked '.next/node_modules/package-link/sentinel')) 'nested junction positive control reaches the external sentinel'
    New-Item -ItemType Directory -Path (Join-Path $linked 'raw') -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $linked 'raw/evidence.txt'), 'raw evidence')
    Assert ((Run-Remove $linked @('-ReleasedHead',$tip)).reason -match 'archive') 'ignored raw evidence refuses cleanup without archive'
    Assert (Test-Path -LiteralPath (Join-Path $linked 'node_modules')) 'archive refusal happens before dependency unlink'
    $copy = Join-Path $fixture 'evidence-copy.txt'
    Copy-Item -LiteralPath (Join-Path $linked 'raw/evidence.txt') -Destination $copy
    $manifest = Join-Path $fixture 'archive.json'
    $archiveProof = @{files=@(@{path='raw/evidence.txt'; archivePath=$copy; sha256=(Get-FileHash -LiteralPath $copy).Hash})}
    Write-Receipt $archiveProof $manifest
    [IO.File]::WriteAllText($copy, 'corrupt copy')
    Assert ((Run-Remove $linked @('-ReleasedHead',$tip,'-ArchiveManifest',$manifest)).reason -match 'mismatch') 'archive hash mismatch refused'
    Copy-Item -LiteralPath (Join-Path $linked 'raw/evidence.txt') -Destination $copy -Force
    $archiveAlias=Join-Path $fixture 'archive-alias'
    New-Item -ItemType Junction -Path $archiveAlias -Target (Join-Path $linked 'raw') | Out-Null
    $aliasFile=Join-Path $archiveAlias 'evidence.txt'
    Assert ((Get-FileHash -LiteralPath $aliasFile).Hash -eq $archiveProof.files[0].sha256) 'external archive junction alias positive control matches the source hash'
    $archiveProof.files[0].archivePath=$aliasFile
    Write-Receipt $archiveProof $manifest
    Assert ((Run-Remove $linked @('-ReleasedHead',$tip,'-ArchiveManifest',$manifest)).reason -match 'Reparse ancestor') 'archive alias back into deleted worktree refused'
    Assert (Test-Path -LiteralPath (Join-Path $linked 'raw/evidence.txt')) 'archive alias refusal preserves raw source'
    [IO.Directory]::Delete($archiveAlias,$false)
    $archiveProof.files[0].archivePath=$copy
    Write-Receipt $archiveProof $manifest
    $availableDrive=@(90..80 | ForEach-Object { ([char]$_).ToString()+':\' } | Where-Object { $_ -notin [IO.Directory]::GetLogicalDrives() } | Select-Object -First 1)
    if ($availableDrive.Count) {
        $drive=$availableDrive[0].TrimEnd('\')
        & subst.exe $drive $linked
        if ($LASTEXITCODE -ne 0) { throw 'Could not create isolated subst fixture mapping' }
        try {
            $substFile=$drive+'\raw\evidence.txt'
            Assert ((Get-FileHash -LiteralPath $substFile).Hash -eq $archiveProof.files[0].sha256) 'subst alias positive control matches raw source'
            $archiveProof.files[0].archivePath=$substFile
            Write-Receipt $archiveProof $manifest
            Assert ((Run-Remove $linked @('-ReleasedHead',$tip,'-ArchiveManifest',$manifest)).reason -match 'physically outside') 'subst drive alias into deleted worktree refused'
        } finally { & subst.exe $drive /d; $archiveProof.files[0].archivePath=$copy; Write-Receipt $archiveProof $manifest }
    } else { Write-Output 'SKIP: no unused drive letter for isolated subst alias fixture' }
    $shortBuffer=[Text.StringBuilder]::new(32768)
    $shortLength=[OpenSetlistRuntime.NativePath]::GetShortPathNameW((Join-Path $linked 'raw/evidence.txt'),$shortBuffer,32768)
    if ($shortLength -gt 0 -and $shortBuffer.ToString() -ne (Join-Path $linked 'raw/evidence.txt')) {
        $archiveProof.files[0].archivePath=$shortBuffer.ToString()
        Write-Receipt $archiveProof $manifest
        Assert ((Run-Remove $linked @('-ReleasedHead',$tip,'-ArchiveManifest',$manifest)).reason -match 'outside') '8.3 short-path alias into deleted worktree refused'
        $archiveProof.files[0].archivePath=$copy
        Write-Receipt $archiveProof $manifest
    } else { Write-Output 'SKIP: volume does not expose an 8.3 short-path alias' }
    $dry = Run-Remove $linked @('-ReleasedHead',$tip,'-ArchiveManifest',$manifest,'-DryRun')
    Assert ($dry.exitCode -eq 0 -and $dry.status -eq 'would-remove' -and (Test-Path -LiteralPath (Join-Path $linked 'node_modules'))) 'dry-run validates archive without unlinking'
    $gitExe=(Get-Command git.exe -CommandType Application | Select-Object -First 1).Source
    $gitBash=Join-Path (Split-Path (Split-Path $gitExe -Parent) -Parent) 'bin/bash.exe'
    $adapterJson=& $gitBash (Join-Path $repoScripts 'worktree-rm.sh') --dry-run --released-head $tip --archive-manifest $manifest $linked
    $adapter=($adapterJson -join "`n") | ConvertFrom-Json
    Assert ($LASTEXITCODE -eq 0 -and $adapter.status -eq 'would-remove') "Git Bash cleanup adapter invokes native validation from a different checkout: $($adapter.reason)"
    $removed = Run-Remove $linked @('-ReleasedHead',$tip,'-ArchiveManifest',$manifest)
    Assert ($removed.exitCode -eq 0 -and $removed.registration -eq 'absent' -and $removed.folder -eq 'absent' -and $removed.unlinked -eq 2) 'registered worktree and nested junctions removed with separate states'
    Assert ((Get-FileHash -LiteralPath $sharedFile).Hash -eq $sharedHash -and (Test-Path -LiteralPath (Join-Path $outside 'sentinel'))) 'shared dependency hash and external junction target preserved'
    Assert ($removed.branchPreserved -and (Get-TaskGitText $repo @('rev-parse','task/linked')) -eq $tip) 'merged branch retained explicitly'
    Assert ((Run-Remove $linked).exitCode -eq 0) 'repeated removal is idempotent'
    $alias = Join-Path $repo '.claude/worktrees/alias'
    New-Item -ItemType Junction -Path $alias -Target $outside | Out-Null
    Assert ((Run-Remove $alias).reason -match 'Reparse ancestor') 'worktree-root junction refused'
    Assert (Test-Path -LiteralPath (Join-Path $alias 'sentinel')) 'refused root junction and target remain reachable'
    [IO.Directory]::Delete($alias,$false)
    $leftover=Join-Path $repo '.claude/worktrees/leftover'
    New-Item -ItemType Directory -Path $leftover | Out-Null
    [IO.File]::WriteAllText((Join-Path $leftover 'raw'), 'orphan evidence')
    Assert ((Run-Remove $leftover).reason -match 'nonempty') 'unregistered nonempty folder refused'
    [IO.File]::Delete((Join-Path $leftover 'raw'))
    $lockScript=Join-Path $fixture 'hold-directory.ps1'
    [IO.File]::WriteAllText($lockScript, @'
[Environment]::CurrentDirectory=$env:OPENSETLIST_FIXTURE_LOCK_PATH
[IO.File]::WriteAllText($env:OPENSETLIST_FIXTURE_LOCK_READY, 'ready')
Start-Sleep -Seconds 120
'@)
    $ready=Join-Path $fixture 'lock-ready'
    $env:OPENSETLIST_FIXTURE_LOCK_PATH=$leftover
    $env:OPENSETLIST_FIXTURE_LOCK_READY=$ready
    $locker=Start-Process -FilePath $shell -ArgumentList @('-NoProfile','-NonInteractive','-File',('"'+$lockScript+'"')) -WorkingDirectory $leftover -WindowStyle Hidden -PassThru
    $children.Add($locker)
    Remove-Item Env:OPENSETLIST_FIXTURE_LOCK_PATH,Env:OPENSETLIST_FIXTURE_LOCK_READY
    $deadline=[DateTime]::UtcNow.AddSeconds(15)
    while (-not (Test-Path -LiteralPath $ready) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
    Assert ((Test-Path -LiteralPath $ready) -and -not $locker.HasExited) 'real Windows current-directory lock acquired'
    try {
        $locked=Run-Remove $leftover
        Assert ($locked.exitCode -eq 2 -and $locked.folder -eq 'empty-locked' -and $locked.registration -eq 'absent') "empty Windows folder lock distinguished from Git registration: $($locked | ConvertTo-Json -Compress)"
        $sweepJson=& $shell -NoProfile -NonInteractive -File (Join-Path $repoScripts 'worktree-rm.ps1') -Sweep
        $sweep=($sweepJson -join "`n") | ConvertFrom-Json
        Assert ($LASTEXITCODE -eq 0 -and @($sweep.entries | Where-Object status -EQ 'active').Count -gt 0 -and @($sweep.entries | Where-Object status -EQ 'locked').Count -eq 1) 'sweep preserves active registrations and reports locked empty folder separately'
    } finally { $locker.Kill(); $null=$locker.WaitForExit(5000) }
    Assert ((Run-Remove $leftover).folder -eq 'absent') 'empty leftover removed after handle release'

    $serverTree=New-Tree 'server'
    $next=Join-Path $serverTree 'node_modules/next/dist/bin'
    New-Item -ItemType Directory -Path $next -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $next 'next'), @'
const http = require('node:http');
for (const key of ['SENTRY_AUTH_TOKEN', 'SENTRY_DSN', 'NEXT_PUBLIC_SENTRY_DSN']) {
  if (process.env[key] !== '') throw new Error('Sentry was not blanked: ' + key);
}
http.createServer((req,res) => { res.end('fixture robots'); }).listen(Number(process.argv[4]), '127.0.0.1');
'@)
    Push-Location $serverTree
    try {
        $port=Free-Port
        $started=Run-Serve $port @('-NoBuild')
        $state=Join-Path (Get-TaskGitText $serverTree @('rev-parse','--absolute-git-dir')) "serve-build-windows-$port.json"
        $receipt=Get-Content -LiteralPath $state -Raw | ConvertFrom-Json
        $serverProcess=Get-Process -Id $receipt.pid
        $children.Add($serverProcess)
        Assert ($started.code -eq 0) "explicit GitBash entry starts isolated fixture: $($started.text)"
        Assert (-not $serverProcess.HasExited) 'owned fixture process positive control is alive'
        Assert ((Run-Remove $serverTree @('-ReleasedHead',$tip)).reason -match 'current directory') 'server checkout cleanup refuses current session'
        Push-Location $repo
        try { Assert ((Run-Remove $serverTree @('-ReleasedHead',$tip)).reason -match 'process') 'server referenced by another live process blocks cleanup from outside the checkout' }
        finally { Pop-Location }
        $original=$receipt.startTicks
        $receipt.startTicks=([long]$original+1).ToString()
        Write-Receipt $receipt $state
        $refused=Run-Serve $port @('-Stop')
        Assert ($refused.code -ne 0 -and $refused.text -match 'unverified PID' -and -not $serverProcess.HasExited) 'stale creation time cannot terminate a reused PID'
        $receipt.startTicks=$original
        $receipt.port=$port+1
        Write-Receipt $receipt $state
        $refused=Run-Serve $port @('-Stop')
        Assert ($refused.code -ne 0 -and $refused.text -match 'unverified PID' -and -not $serverProcess.HasExited) 'wrong-port receipt cannot terminate a live holder'
        $receipt.port=$port
        $receipt.pid=$PID
        $receipt.startTicks=(Get-Process -Id $PID).StartTime.ToUniversalTime().Ticks.ToString()
        Write-Receipt $receipt $state
        $refused=Run-Serve $port @('-Stop')
        Assert ($refused.code -ne 0 -and $refused.text -match 'unverified PID' -and -not $serverProcess.HasExited) 'receipt pointing at an unrelated live process cannot terminate it'
        $receipt.pid=$serverProcess.Id
        $receipt.startTicks=$original
        Write-Receipt $receipt $state
        [IO.File]::Delete($state)
        $refused=Run-Serve $port @('-Stop')
        Assert ($refused.code -ne 0 -and $refused.text -match 'unverified PID' -and -not $serverProcess.HasExited) 'legacy PID alone cannot stop an unverified port holder'
        Write-Receipt $receipt $state
        Assert ((Run-Serve $port @('-Stop')).code -eq 0) 'matching receipt stops only the owned server'
        Assert ($serverProcess.WaitForExit(5000)) 'owned server actually exited'
        Assert ((Run-Serve $port @('-Stop')).code -eq 0) 'repeated stop is safe'
        $mutexPort=Free-Port
        $testMutex=[Threading.Mutex]::new($false,"Local\OpenSetlistServe-$mutexPort")
        $null=$testMutex.WaitOne(0)
        try {
            $busy=Run-Serve $mutexPort @('-Stop')
            Assert ($busy.code -ne 0 -and $busy.text -match 'Another native serve-build operation') 'per-port mutex refuses a concurrent native operation'
        } finally { $testMutex.ReleaseMutex(); $testMutex.Dispose() }
        [IO.File]::WriteAllText((Join-Path $serverTree 'package.json'), '{"scripts":{"build":"node build-fixture.cjs"}}')
        [IO.File]::WriteAllText((Join-Path $serverTree 'build-fixture.cjs'), @'
const fs = require('node:fs');
for (const key of ['SENTRY_AUTH_TOKEN', 'SENTRY_DSN', 'NEXT_PUBLIC_SENTRY_DSN']) {
  if (process.env[key] !== '') throw new Error('Build Sentry not blanked: ' + key);
}
fs.mkdirSync('.next', { recursive: true });
fs.writeFileSync('.next/build-fixture', 'built');
'@)
        $savedSentry=$env:SENTRY_DSN
        $env:SENTRY_DSN='fixture-nonempty-before-build'
        try { $built=Run-Serve $port } finally { $env:SENTRY_DSN=$savedSentry }
        $builtReceipt=Get-Content -LiteralPath $state -Raw | ConvertFrom-Json
        $builtServer=Get-Process -Id $builtReceipt.pid
        $children.Add($builtServer)
        Assert ($built.code -eq 0 -and (Test-Path -LiteralPath (Join-Path $serverTree '.next/build-fixture'))) 'npm build and detached server both receive empty Sentry values'
        Assert ((Run-Serve $port @('-Stop')).code -eq 0 -and $builtServer.WaitForExit(5000)) 'built fixture server stops with its new verified receipt'
    } finally { Pop-Location }
    $success=$true
    Write-Output "Windows runtime fixture: $checks checks passed"
} finally {
    Pop-Location
    foreach ($child in $children) { try { if (-not $child.HasExited) { $child.Kill(); $null=$child.WaitForExit(5000) }; $child.Dispose() } catch { Write-Warning $_ } }
    if ($success) {
        # Only this independently created absolute fixture is recursively cleaned.
        # Unlink junctions first; never pass enumerated names to another shell.
        $full=Get-AbsoluteTaskPath $fixture
        $temp=Get-AbsoluteTaskPath ([IO.Path]::GetTempPath())
        if (-not $full.StartsWith($temp+'\',[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($full) -notlike 'opensetlist runtime *') { throw 'Unexpected fixture cleanup scope' }
        foreach ($link in @(Get-TaskInventory $full | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })) { Remove-TaskLink $link }
        Remove-Item -LiteralPath $full -Recurse -Force
    } else { Write-Output "Failed fixture preserved: $fixture" }
}
