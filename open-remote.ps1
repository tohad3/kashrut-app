# Opens the kashrut app that runs on the other computer, through the tunnel address it sent to GitHub
# (see tunnel.ps1). Run it through open-remote.bat.
$app = $PSScriptRoot
$urlFile = Join-Path $app 'tunnel-url.txt'
$git = (Get-Command git -ErrorAction SilentlyContinue).Source
if (-not $git -and (Test-Path "$env:ProgramFiles\Git\cmd\git.exe")) { $git = "$env:ProgramFiles\Git\cmd\git.exe" }

Write-Host 'Getting the latest address from GitHub...'
if ($git) { & $git -C $app pull -q --rebase origin HEAD }
if ($LASTEXITCODE -ne 0) { Write-Host 'Could not update from GitHub - using the last known address.' }

$lines = if (Test-Path $urlFile) { @(Get-Content $urlFile) } else { @() }
$url = if ($lines.Count -and $lines[0] -match '^https://') { $lines[0].Trim() } else { $null }
if (-not $url) {
  Write-Host 'Remote access is not open on the other computer.'
  if ($lines.Count) { Write-Host "(last status: $($lines[0]))" }
  Write-Host 'On the other computer, run remote-tunnel.bat from the kashrut app folder, wait a minute, and try again.'
  exit 1
}
if ($lines.Count -gt 1) { Write-Host "Address $($lines[1])" }

try { $null = Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 15 }
catch {
  Write-Host "The address $url does not answer. The tunnel on the other computer was probably closed."
  Write-Host 'Run remote-tunnel.bat there again, wait a minute, and try again.'
  exit 1
}
Start-Process $url
