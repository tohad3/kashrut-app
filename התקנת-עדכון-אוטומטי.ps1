$ErrorActionPreference = 'Stop'
function Done($msg,$color){ Write-Host ''; Write-Host $msg -ForegroundColor $color; Write-Host ''; Read-Host 'לחץ Enter לסגירה' | Out-Null }
try {
  $app = Join-Path $env:USERPROFILE 'kashrut-app'
  if (-not (Test-Path $app)) { Done 'לא נמצאה התיקייה kashrut-app בבית. ודא שהאפליקציה הותקנה ב-C:\Users\<שמך>\kashrut-app' Red; exit 1 }
  $shared = Get-ChildItem (Join-Path $env:USERPROFILE 'OneDrive*') -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '*אפליקציית כשרות - נתונים' } | Select-Object -First 1
  if (-not $shared) { Done 'לא נמצאה התיקייה המשותפת. ודא שהיא מסונכרנת במחשב (וי ירוק).' Red; exit 1 }
  $boot = Join-Path $shared.FullName '_app\bootstrap.js'
  if (-not (Test-Path $boot)) { Done 'עדיין אין _app\bootstrap.js בתיקייה המשותפת. המתן לסנכרון (דקה-שתיים) ונסה שוב.' Yellow; exit 1 }
  Copy-Item $boot (Join-Path $app 'bootstrap.js') -Force
  $icoSrc = Join-Path $shared.FullName '_app\kashrut.ico'
  if (Test-Path $icoSrc) { Copy-Item $icoSrc (Join-Path $app 'kashrut.ico') -Force }
  Set-Content (Join-Path $app 'start.bat') -Encoding ASCII -Value @('@echo off','cd /d "%~dp0"','start "" http://localhost:3000','"%~dp0node\node.exe" bootstrap.js')
  $sh = New-Object -ComObject WScript.Shell
  $lnk = $sh.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'ניהול כשרות.lnk'))
  $lnk.TargetPath = (Join-Path $app 'start.bat'); $lnk.WorkingDirectory = $app; $lnk.WindowStyle = 7
  if (Test-Path (Join-Path $app 'kashrut.ico')) { $lnk.IconLocation = (Join-Path $app 'kashrut.ico') + ',0' }
  $lnk.Save()
  Done 'הצליח! עדכון אוטומטי מופעל, ויש קיצור דרך "ניהול כשרות" בשולחן העבודה (חלון ממוזער). מעכשיו פשוט לחץ עליו.' Green
} catch { Done ('אירעה שגיאה: ' + $_.Exception.Message) Red; exit 1 }
