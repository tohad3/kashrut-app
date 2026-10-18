# Opens a temporary HTTPS tunnel (Cloudflare) to the app running on this computer,
# and saves the address to tunnel-url.txt and pushes it to GitHub so the other computer can open it.
# Run it through remote-tunnel.bat. The tunnel stays up while the window is open.
$ErrorActionPreference = 'Stop'
$app = $PSScriptRoot
$port = 3000
$urlFile = Join-Path $app 'tunnel-url.txt'
$log = Join-Path $env:TEMP 'kashrut-tunnel.log'

function Find-Exe($name, $fallbacks) {
  $c = Get-Command $name -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  foreach ($f in $fallbacks) { if ($f -and (Test-Path $f)) { return $f } }
  return $null
}
$cfPaths = @("$env:ProgramFiles\cloudflared\cloudflared.exe", "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe", "$env:LOCALAPPDATA\Microsoft\WinGet\Links\cloudflared.exe")
$git = Find-Exe 'git' @("$env:ProgramFiles\Git\cmd\git.exe", "$env:USERPROFILE\Git\cmd\git.exe")

function Publish($text, $msg) {
  [IO.File]::WriteAllText($urlFile, $text, (New-Object Text.UTF8Encoding $false))
  if (-not $git) { Write-Host 'Git not found - the address was saved only on this computer.'; return }
  & $git -C $app add tunnel-url.txt
  & $git -C $app commit -q -m $msg
  & $git -C $app pull -q --rebase origin HEAD
  & $git -C $app push -q origin HEAD
  if ($LASTEXITCODE -eq 0) { Write-Host 'The address was sent to GitHub.' } else { Write-Host 'Sending to GitHub failed - the other computer will not see the new address.' }
}

# 1. the app must already be running (from its usual desktop shortcut)
if (-not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) {
  Write-Host "The kashrut app is not running on port $port."
  Write-Host 'Open it from its desktop shortcut first, then run this file again.'
  exit 1
}

# 2. cloudflared (installed once)
$cf = Find-Exe 'cloudflared' $cfPaths
if (-not $cf) {
  Write-Host 'Installing cloudflared (one time)...'
  winget install --id Cloudflare.cloudflared -e
  $cf = Find-Exe 'cloudflared' $cfPaths
  if (-not $cf) { Write-Host 'Installing cloudflared failed.'; exit 1 }
}

# 3. start the tunnel and wait for its address
if (Test-Path $log) { Remove-Item $log -Force }
Write-Host 'Opening the tunnel...'
$p = Start-Process $cf -ArgumentList 'tunnel', '--no-autoupdate', '--url', "http://localhost:$port" -RedirectStandardError $log -WindowStyle Hidden -PassThru
$url = $null
for ($i = 0; $i -lt 60 -and -not $url -and -not $p.HasExited; $i++) {
  Start-Sleep 1
  $m = Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($m) { $url = $m.Matches[0].Value }
}
if (-not $url) {
  Write-Host 'The tunnel did not open. Details:'; Get-Content $log -Tail 15 -ErrorAction SilentlyContinue
  if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }
  exit 1
}

$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm'
Publish "$url`r`nopened $stamp on $env:COMPUTERNAME`r`n" "Tunnel address $stamp ($env:COMPUTERNAME)"
try { Set-Clipboard $url } catch {}
Write-Host ''
Write-Host "Address: $url  (copied to the clipboard)"
Write-Host 'Keep this window open. Closing it stops the remote access.'
Write-Host 'To stop properly (and tell the other computer), press Ctrl+C.'

try { Wait-Process -Id $p.Id }
finally {
  if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }
  Publish "stopped $(Get-Date -Format 'yyyy-MM-dd HH:mm') on $env:COMPUTERNAME`r`n" "Tunnel stopped ($env:COMPUTERNAME)"
}
