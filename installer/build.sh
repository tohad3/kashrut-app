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
(cd "$STAGE" && makensis -V2 -DVERSION="$(date +%Y.%m.%d)" kashrut-setup.nsi)
mkdir -p "$ROOT/dist"
mv -f "$STAGE/kashrut-setup.exe" "$ROOT/dist/התקנת ניהול כשרות.exe"
