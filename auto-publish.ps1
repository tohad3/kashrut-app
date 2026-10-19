# auto-publish.ps1 - runs every 5 minutes from Task Scheduler (task "kashrut-auto-publish").
# Pulls new code from GitHub and, if anything changed, publishes it to the shared OneDrive folder
# with publish-code.js, so changes pushed from the cloud reach every user without touching this PC.
# Writes to the log only when there is an update or an error. ASCII only (Windows PowerShell 5 reads it as ANSI).
$ErrorActionPreference = 'Continue'
$app = $PSScriptRoot
$log = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'kashrut-auto-publish.log'
function Log($msg) { Add-Content -Path $log -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $msg) }

$git = Join-Path $env:LOCALAPPDATA 'Programs\MinGit\cmd\git.exe'
if (-not (Test-Path $git)) { $git = 'git' }
$node = Join-Path $env:LOCALAPPDATA 'nodejs-portable\node-v24.21.0-win-x64\node.exe'
if (-not (Test-Path $node)) { $node = 'node' }

Set-Location $app
# node writes UTF-8; read it as UTF-8 so the receipt keeps the Hebrew readable
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:GIT_TERMINAL_PROMPT = '0'
$out = & $git fetch -q origin main 2>&1
if ($LASTEXITCODE -ne 0) { Log "fetch failed: $out"; exit 1 }
$local = (& $git rev-parse HEAD).Trim()
$remote = (& $git rev-parse origin/main).Trim()
$base = (& $git merge-base HEAD origin/main).Trim()
# nothing new on GitHub (or this PC is ahead and publish-code.js will push it next time)
if ($local -eq $remote -or $remote -eq $base) { exit 0 }

if (& $git status --porcelain) { Log 'skipped: there are unsaved local changes in kashrut-app (run node publish-code.js first)'; exit 1 }
$out = & $git merge --no-edit origin/main 2>&1
if ($LASTEXITCODE -ne 0) { & $git merge --abort 2>&1 | Out-Null; Log "merge failed, nothing published: $out"; exit 1 }

$out = & $node publish-code.js 2>&1
$head = & $git log -1 --format='%h %s'
Log ("published " + $head + " | " + ($out -join ' / '))
# a receipt on GitHub, so whoever pushed the change can see it reached the shared folder
Set-Content -Path (Join-Path $app 'last-auto-publish.txt') -Encoding UTF8 -Value (@((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $head) + @($out))
& $git add last-auto-publish.txt 2>&1 | Out-Null
& $git commit -q -m 'auto-publish receipt' 2>&1 | Out-Null
$out = & $git push -q origin HEAD:main 2>&1
if ($LASTEXITCODE -ne 0) { Log "receipt push failed: $out" }
