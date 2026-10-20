# launch-app.ps1 - starts one of the local Node apps on this PC (mashgichim-app, outlook-tracker) without cmd/.bat,
# which are blocked on the council PC. The desktop shortcuts run it; auto-publish.ps1 points them here.
# Usage: powershell -ExecutionPolicy Bypass -WindowStyle Minimized -File launch-app.ps1 -Dir <app folder> -Port <port>
# ASCII only (Windows PowerShell 5 reads it as ANSI).
param([Parameter(Mandatory = $true)][string]$Dir, [Parameter(Mandatory = $true)][int]$Port)
$node = Join-Path $env:LOCALAPPDATA 'nodejs-portable\node-v24.21.0-win-x64\node.exe'
if (-not (Test-Path $node)) { $node = 'node' }
$url = "http://localhost:$Port"
function Up {
  $c = New-Object Net.Sockets.TcpClient
  try { $c.Connect('127.0.0.1', $Port); $true } catch { $false } finally { $c.Close() }
}
# a second click while the app is running just opens the browser
if (-not (Up)) {
  Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory $Dir -WindowStyle Minimized
  for ($i = 0; $i -lt 90 -and -not (Up); $i++) { Start-Sleep -Seconds 1 }
}
Start-Process $url
