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
# node writes UTF-8; read it as UTF-8 so the receipt keeps the Hebrew readable (can fail without a console)
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$env:GIT_TERMINAL_PROMPT = '0'
# the commit that was last published successfully; publishing is retried until it matches HEAD
$marker = Join-Path $app '.last-published'
$out = & $git fetch -q origin main 2>&1
if ($LASTEXITCODE -ne 0) { Log "fetch failed: $out"; exit 1 }
$local = (& $git rev-parse HEAD).Trim()
$remote = (& $git rev-parse origin/main).Trim()
$base = (& $git merge-base HEAD origin/main).Trim()
if ($local -ne $remote -and $remote -ne $base) {
  if (& $git status --porcelain) { Log 'skipped: there are unsaved local changes in kashrut-app (run node publish-code.js first)'; exit 1 }
  $out = & $git merge --no-edit origin/main 2>&1
  if ($LASTEXITCODE -ne 0) { & $git merge --abort 2>&1 | Out-Null; Log "merge failed, nothing published: $out"; exit 1 }
}
# cmd/.bat are blocked on this PC, so a desktop shortcut of this app that still points at start.bat
# is switched to run node with bootstrap.js directly (bootstrap.js keeps it up to date from then on)
try {
  $sh = New-Object -ComObject WScript.Shell
  Get-ChildItem -LiteralPath ([Environment]::GetFolderPath('Desktop')) -Filter *.lnk -ErrorAction Stop | ForEach-Object {
    $l = $sh.CreateShortcut($_.FullName)
    if ($l.TargetPath -notlike (Join-Path $app '*.bat')) { return }
    $l.TargetPath = $node
    $l.Arguments = '"' + (Join-Path $app 'bootstrap.js') + '" --open'
    $l.WorkingDirectory = $app
    $l.WindowStyle = 7
    $ico = Join-Path $app 'kashrut.ico'
    if (Test-Path $ico) { $l.IconLocation = "$ico,0" }
    $l.Save()
    Log "shortcut switched from start.bat to node: $($_.Name)"
  }
  # the other local apps (mashgichim-app, outlook-tracker) start through launch-app.ps1 instead of their start.bat
  $launcher = Join-Path $app 'launch-app.ps1'
  Get-ChildItem -LiteralPath ([Environment]::GetFolderPath('Desktop')) -Filter *.lnk -ErrorAction Stop | ForEach-Object {
    $l = $sh.CreateShortcut($_.FullName)
    if ($l.TargetPath -notlike '*\start.bat' -or -not (Test-Path -LiteralPath $l.TargetPath)) { return }
    $dir = Split-Path $l.TargetPath
    $m = [regex]::Match((Get-Content -LiteralPath $l.TargetPath -Raw), 'localhost:(\d+)')
    if (-not $m.Success -or -not (Test-Path (Join-Path $dir 'server.js'))) { return }
    $l.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $l.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $launcher + '" -Dir "' + $dir + '" -Port ' + $m.Groups[1].Value
    $l.WorkingDirectory = $dir
    $l.WindowStyle = 7
    $ico = Join-Path $dir 'app.ico'
    $l.IconLocation = if (Test-Path $ico) { "$ico,0" } else { "$node,0" }
    $l.Save()
    Log "shortcut switched from start.bat to launch-app.ps1: $($_.Name)"
  }
  # icons for those apps live here in icons\<app folder name>.ico, so a new icon reaches this PC with a push
  Get-ChildItem -LiteralPath ([Environment]::GetFolderPath('Desktop')) -Filter *.lnk -ErrorAction Stop | ForEach-Object {
    $l = $sh.CreateShortcut($_.FullName)
    $m = [regex]::Match($l.Arguments, 'launch-app\.ps1" -Dir "([^"]+)"')
    if (-not $m.Success) { return }
    # a new icon gets a new file name (icons\<app>-2.ico, -3...), because Windows caches icons by path
    $leaf = Split-Path $m.Groups[1].Value -Leaf
    $ico = Get-ChildItem -LiteralPath (Join-Path $app 'icons') -Filter "$leaf*.ico" -ErrorAction SilentlyContinue | Sort-Object Name | Select-Object -Last 1
    if (-not $ico -or $l.IconLocation -eq "$($ico.FullName),0") { return }
    $ico = $ico.FullName
    $l.IconLocation = "$ico,0"
    $l.Save()
    Log "shortcut icon set: $($_.Name)"
  }
} catch { Log "shortcut check failed: $_" }
# the last commit that changed anything but the receipt; receipt commits never trigger a publish
$code = (& $git log -1 --format=%H -- . ':(exclude)last-auto-publish.txt').Trim()
$last = if (Test-Path $marker) { (Get-Content $marker -TotalCount 1).Trim() } else { '' }
if ($code -eq $last) { exit 0 }

$out = & $node publish-code.js 2>&1
$ok = ($LASTEXITCODE -eq 0)
$head = & $git log -1 --format='%h %s' $code
Log ($(if ($ok) { 'published ' } else { 'publish FAILED, will retry: ' }) + $head + ' | ' + ($out -join ' / '))
if ($ok) { Set-Content -Path $marker -Value $code }
# a failure is reported on GitHub once per commit, then retried quietly every run
$failMarker = Join-Path $app '.last-failed'
if (-not $ok) {
  if ((Test-Path $failMarker) -and ((Get-Content $failMarker -TotalCount 1).Trim() -eq $code)) { exit 1 }
  Set-Content -Path $failMarker -Value $code
}
# this PC's app shortcuts and last launches, so a shortcut problem here can be diagnosed from GitHub
function Diag {
  '--- shortcuts on this PC ---'
  $sh = New-Object -ComObject WScript.Shell
  $dirs = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('CommonDesktopDirectory'), (Join-Path ([Environment]::GetFolderPath('Programs')) ''))
  foreach ($d in $dirs | Select-Object -Unique) {
    if (-not $d -or -not (Test-Path $d)) { continue }
    Get-ChildItem -LiteralPath $d -Filter *.lnk -ErrorAction SilentlyContinue | ForEach-Object {
      $l = $sh.CreateShortcut($_.FullName)
      if (($l.TargetPath + $l.Arguments) -notmatch 'kashrut|bootstrap|node|start\.') { return }
      "$($_.FullName) | target: $($l.TargetPath) (exists: $(Test-Path -LiteralPath $l.TargetPath)) | args: $($l.Arguments) | dir: $($l.WorkingDirectory) | style: $($l.WindowStyle) | icon: $($l.IconLocation) | modified: $($_.LastWriteTime.ToString('yyyy-MM-dd HH:mm'))"
    }
  }
  '--- node processes ---'
  Get-CimInstance Win32_Process -Filter "name='node.exe'" -ErrorAction SilentlyContinue | ForEach-Object { "$($_.ProcessId) $($_.CommandLine)" }
  $c = New-Object Net.Sockets.TcpClient
  try { $c.Connect('127.0.0.1', 3000); 'port 3000: answering' } catch { 'port 3000: not answering' } finally { $c.Close() }
  foreach ($f in @((Join-Path $app 'launch.log'), (Join-Path $env:USERPROFILE 'kashrut-app\launch.log'))) {
    if (Test-Path $f) { "--- $f ---"; Get-Content $f -Tail 25 -Encoding UTF8 }
  }
}
$diag = try { Diag 2>&1 | ForEach-Object { "$_" } } catch { "diag failed: $_" }
# a receipt on GitHub, so whoever pushed the change can see it reached the shared folder (or why not)
$status = if ($ok) { '' } else { 'PUBLISH FAILED, retrying every run  ' }
Set-Content -Path (Join-Path $app 'last-auto-publish.txt') -Encoding UTF8 -Value (@($status + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $head) + @($out | ForEach-Object { "$_" }) + @($diag))
& $git add last-auto-publish.txt 2>&1 | Out-Null
& $git commit -q -m 'auto-publish receipt' 2>&1 | Out-Null
$out = & $git push -q origin HEAD:main 2>&1
if ($LASTEXITCODE -ne 0) { Log "receipt push failed: $out" }
