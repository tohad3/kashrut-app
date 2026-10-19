# התקנת "ניהול כשרות" בלי קובץ exe. נמצא בתיקייה המשותפת ב-OneDrive.
# הפעלה: לחיצה ימנית על הקובץ ואז "הפעל באמצעות PowerShell" (Run with PowerShell).
# מעתיק את האפליקציה ואת Node מהתיקייה המשותפת ל-C:\Users\<שם>\kashrut-app ויוצר קיצור דרך.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
function Say($msg, $icon = 'Information', $buttons = 'OK') {
  [System.Windows.Forms.MessageBox]::Show($msg, 'ניהול כשרות', $buttons, $icon, 'Button1', 'RtlReading, RightAlign')
}
$shareUrl = 'https://mdhaifa-my.sharepoint.com/:f:/g/personal/ohadt_mdhaifa_org_il/IgCRbTQIUvS4QbJmd-35g1WwATOR1rVL9CJ3pRqtVwAvQwk?e=eCBEvc'
try {
  $src = Join-Path $PSScriptRoot '_app'
  $nodeSrc = Join-Path $src 'node\node.exe'
  if (-not (Test-Path (Join-Path $src 'server.js')) -or -not (Test-Path $nodeSrc)) {
    Say "לא נמצאו קבצי האפליקציה ליד הקובץ הזה.`r`nהפעל אותו מתוך התיקייה המשותפת 'אפליקציית כשרות - נתונים' ב-OneDrive, אחרי שהיא סיימה להסתנכרן." 'Error' | Out-Null
    exit 1
  }
  # הקובץ צריך לרוץ מהתיקייה המשותפת המסונכרנת, לא מעותק שהורד
  $synced = $PSScriptRoot -like (Join-Path $env:USERPROFILE 'OneDrive*')
  if (-not $synced) {
    $r = Say "נראה שהקובץ רץ מעותק שהורד, ולא מהתיקייה המשותפת ב-OneDrive. בלי התיקייה המשותפת לא יהיו עדכונים ונתונים משותפים.`r`n`r`n'אישור' יפתח את התיקייה בדפדפן. לחץ שם 'הוסף קיצור דרך לקבצים שלי', ואחרי שהיא תופיע ב-OneDrive במחשב הפעל את ההתקנה משם.`r`n'ביטול' ימשיך להתקין בכל זאת." 'Warning' 'OKCancel'
    if ($r -eq 'OK') { Start-Process $shareUrl; exit 0 }
  }

  $app = Join-Path $env:USERPROFILE 'kashrut-app'
  # עוצר עותק פועל של האפליקציה, כדי שאפשר יהיה להחליף קבצים
  Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$app\*" } | Stop-Process -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path (Join-Path $app 'node') | Out-Null
  foreach ($f in 'server.js', 'bootstrap.js', 'kashrut.ico') {
    $p = Join-Path $src $f
    if (Test-Path $p) { Copy-Item $p (Join-Path $app $f) -Force }
  }
  Copy-Item (Join-Path $src 'public') $app -Recurse -Force
  $node = Join-Path $app 'node\node.exe'
  Copy-Item $nodeSrc $node -Force
  Get-ChildItem $app -Recurse -File | Unblock-File -ErrorAction SilentlyContinue

  # קיצור דרך בשולחן העבודה ובתפריט התחל (bootstrap.js מרענן אותו בכל הפעלה)
  $sh = New-Object -ComObject WScript.Shell
  $places = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))
  foreach ($dir in $places) {
    $lnk = $sh.CreateShortcut((Join-Path $dir 'ניהול כשרות.lnk'))
    $lnk.TargetPath = $node
    $lnk.Arguments = '"' + (Join-Path $app 'bootstrap.js') + '" --open'
    $lnk.WorkingDirectory = $app
    $lnk.WindowStyle = 7
    $ico = Join-Path $app 'kashrut.ico'
    if (Test-Path $ico) { $lnk.IconLocation = "$ico,0" }
    $lnk.Save()
  }

  Start-Process $node -ArgumentList ('"' + (Join-Path $app 'bootstrap.js') + '" --open') -WorkingDirectory $app -WindowStyle Minimized
  Say "ההתקנה הסתיימה.`r`nיש עכשיו קיצור דרך 'ניהול כשרות' בשולחן העבודה, והאפליקציה נפתחת בדפדפן." | Out-Null
} catch {
  Say ('ההתקנה נכשלה: ' + $_.Exception.Message) 'Error' | Out-Null
  exit 1
}
