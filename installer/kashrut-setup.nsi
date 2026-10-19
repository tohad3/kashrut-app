; התקנת "ניהול כשרות" - קובץ התקנה אחד, בלי הרשאות מנהל.
; נבנה עם build.sh (מוריד node.exe, מעתיק את הקבצים לתיקייה זמנית ומריץ שם makensis). מתקין ל-C:\Users\<שם>\kashrut-app,
; יוצר קיצור דרך בשולחן העבודה ובתפריט התחל, ונרשם ב"אפליקציות" להסרה.
Unicode true
!include "MUI2.nsh"

!define APPNAME "ניהול כשרות"
!define REGKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\kashrut-app"
!ifndef VERSION
  !define VERSION "1.0"
!endif

Name "${APPNAME}"
OutFile "kashrut-setup.exe"
InstallDir "$PROFILE\kashrut-app"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "${APPNAME}"

!define MUI_ICON "app/kashrut.ico"
!define MUI_UNICON "app/kashrut.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "לפתוח את האפליקציה עכשיו"
!define MUI_FINISHPAGE_RUN_FUNCTION RunApp
!define MUI_WELCOMEPAGE_TEXT "ההתקנה תוסיף את האפליקציה למחשב ותיצור קיצור דרך בשולחן העבודה.$\r$\n$\r$\nלא צריך הרשאות מנהל. האפליקציה תתעדכן לבד מהתיקייה המשותפת ב-OneDrive.$\r$\n$\r$\nלחץ 'הבא' כדי להמשיך."

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Hebrew"

; עוצר עותק פועל של האפליקציה מהתיקייה הזו, כדי שאפשר יהיה להחליף את הקבצים
!macro StopApp
  nsExec::Exec `powershell.exe -NoProfile -NonInteractive -Command "Get-Process node -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like '$INSTDIR\*' } | Stop-Process -Force"`
  Pop $0
!macroend

Function RunApp
  Exec `"$INSTDIR\node\node.exe" "$INSTDIR\bootstrap.js" --open`
FunctionEnd

Section "install"
  !insertmacro StopApp
  SetOutPath "$INSTDIR"
  File "app/server.js"
  File "app/bootstrap.js"
  File "app/package.json"
  File "app/kashrut.ico"
  SetOutPath "$INSTDIR\public"
  File /r "app/public/*.*"
  SetOutPath "$INSTDIR\node"
  File "node.exe"
  ; התיקיות data ו-data-shared (הנתונים של המשתמש) לא נוגעים בהן

  SetOutPath "$INSTDIR"
  CreateShortcut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\node\node.exe" `"$INSTDIR\bootstrap.js" --open` "$INSTDIR\kashrut.ico" 0 SW_SHOWMINIMIZED
  CreateShortcut "$SMPROGRAMS\${APPNAME}.lnk" "$INSTDIR\node\node.exe" `"$INSTDIR\bootstrap.js" --open` "$INSTDIR\kashrut.ico" 0 SW_SHOWMINIMIZED

  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr HKCU "${REGKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${REGKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${REGKEY}" "Publisher" "המועצה הדתית חיפה"
  WriteRegStr HKCU "${REGKEY}" "DisplayIcon" "$INSTDIR\kashrut.ico"
  WriteRegStr HKCU "${REGKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${REGKEY}" "UninstallString" `"$INSTDIR\uninstall.exe"`
  WriteRegDWORD HKCU "${REGKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${REGKEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  !insertmacro StopApp
  Delete "$DESKTOP\${APPNAME}.lnk"
  Delete "$SMPROGRAMS\${APPNAME}.lnk"
  RMDir /r "$INSTDIR\node"
  RMDir /r "$INSTDIR\public"
  Delete "$INSTDIR\server.js"
  Delete "$INSTDIR\bootstrap.js"
  Delete "$INSTDIR\package.json"
  Delete "$INSTDIR\kashrut.ico"
  Delete "$INSTDIR\uninstall.exe"
  ; הנתונים המקומיים (data, data-shared) נשארים, למקרה של התקנה מחדש
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "${REGKEY}"
SectionEnd
