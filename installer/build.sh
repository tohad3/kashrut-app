#!/bin/sh
# בונה את dist/התקנת ניהול כשרות.exe. צריך makensis (apt install nsis) ו-curl.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HERE/.."
NODE_VER=v24.21.0
if [ ! -f "$HERE/node.exe" ]; then
  curl -sSfLo "$HERE/node.exe" "https://nodejs.org/dist/$NODE_VER/win-x64/node.exe"
  (cd "$HERE" && curl -sSfL "https://nodejs.org/dist/$NODE_VER/SHASUMS256.txt" | grep ' win-x64/node.exe$' | sed 's#win-x64/##' | sha256sum -c -)
fi
# makensis בלינוקס קרס על קבצים ישירות מתיקיית המאגר, לכן בונים מעותק בתיקייה זמנית
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/app"
cp -r "$ROOT/server.js" "$ROOT/bootstrap.js" "$ROOT/package.json" "$ROOT/kashrut.ico" "$ROOT/public" "$STAGE/app/"
cp "$HERE/node.exe" "$HERE/kashrut-setup.nsi" "$STAGE/"
# בדיקת התיקייה המשותפת (אותו זיהוי כמו ב-bootstrap.js), מקודדת כדי לחסוך בעיות מרכאות ועברית
CHECK='$n = "אפליקציית כשרות - נתונים"; $a = @(Get-ChildItem (Join-Path $env:USERPROFILE "OneDrive*") -Directory -ErrorAction SilentlyContinue); $b = @($a | Get-ChildItem -Directory -ErrorAction SilentlyContinue); $hit = ($a + $b) | Where-Object { $_.Name -like ("*" + $n) }; if ($hit) { exit 0 } else { exit 1 }'
CHECK_B64="$(printf '%s' "$CHECK" | iconv -f UTF-8 -t UTF-16LE | base64 -w0)"
# קישור השיתוף של התיקייה ב-OneDrive (שורה אחת), אם קיים
SHARE_URL="$(head -n1 "$HERE/share-link.txt" 2>/dev/null | tr -d '\r' || true)"
set -- -V2 -DVERSION="$(date +%Y.%m.%d)" -DCHECK_B64="$CHECK_B64"
[ -n "$SHARE_URL" ] && set -- "$@" -DSHARE_URL="$SHARE_URL"
(cd "$STAGE" && makensis "$@" kashrut-setup.nsi)
mkdir -p "$ROOT/dist"
cp "$STAGE/kashrut-setup.exe" "$ROOT/dist/התקנת ניהול כשרות.exe"
mkdir -p "$HERE/release" && mv -f "$STAGE/kashrut-setup.exe" "$HERE/release/kashrut-setup.exe"
