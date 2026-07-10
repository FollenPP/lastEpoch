#!/usr/bin/env bash
set -euo pipefail

ZIP_PATH="${1:-$HOME/Downloads/last-epoch-companion.zip}"
PLUGIN_ID="last-epoch-companion"
STAGE="/tmp/${PLUGIN_ID}-install"
TARGET="$HOME/homebrew/plugins/${PLUGIN_ID}"

if [[ "$ZIP_PATH" =~ ^https?:// ]]; then
  URL="$ZIP_PATH"
  ZIP_PATH="/tmp/${PLUGIN_ID}.zip"
  echo "Downloading $URL"
  curl -fL "$URL" -o "$ZIP_PATH"
fi

if [[ ! -f "$ZIP_PATH" ]]; then
  echo "Zip not found: $ZIP_PATH"
  echo "Usage: $0 /path/to/last-epoch-companion.zip"
  exit 1
fi

rm -rf "$STAGE"
mkdir -p "$STAGE"
unzip -o "$ZIP_PATH" -d "$STAGE" >/dev/null

if [[ -f "$STAGE/$PLUGIN_ID/plugin.json" ]]; then
  SRC="$STAGE/$PLUGIN_ID"
elif [[ -f "$STAGE/plugin.json" ]]; then
  SRC="$STAGE"
else
  echo "plugin.json was not found after unzip."
  echo "Archive contents:"
  find "$STAGE" -maxdepth 4 -type f | sort
  exit 1
fi

if [[ ! -f "$SRC/dist/index.js" ]]; then
  echo "dist/index.js was not found."
  find "$SRC" -maxdepth 4 -type f | sort
  exit 1
fi

sudo rm -rf "$TARGET"
sudo mkdir -p "$TARGET"
sudo cp -a "$SRC/." "$TARGET/"
sudo chmod -R a+rX "$TARGET"
sudo chown -R "$USER:$USER" "$TARGET" 2>/dev/null || true

echo "Installed files:"
find "$TARGET" -maxdepth 3 -type f | sort

sudo systemctl daemon-reload 2>/dev/null || true
if sudo systemctl restart plugin_loader 2>/tmp/last-epoch-companion-systemctl.log; then
  echo "Decky plugin loader restarted."
elif sudo systemctl restart plugin_loader.service 2>/tmp/last-epoch-companion-systemctl.log; then
  echo "Decky plugin loader restarted."
elif systemctl --user restart plugin_loader 2>/tmp/last-epoch-companion-systemctl.log; then
  echo "Decky user plugin loader restarted."
elif systemctl --user restart plugin_loader.service 2>/tmp/last-epoch-companion-systemctl.log; then
  echo "Decky user plugin loader restarted."
else
  echo "Could not restart Decky plugin loader."
  echo "Restart error:"
  cat /tmp/last-epoch-companion-systemctl.log
  echo ""
  echo "Reboot Steam Deck or reinstall/restart Decky from its installer."
  exit 0
fi

echo "Return to Gaming Mode and open Decky."
