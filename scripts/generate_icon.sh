#!/usr/bin/env bash
# Generate the macOS .icns asset from the CC BY-NC-SA 4.0 DeepSeek whale-girl artwork.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ASSETS="$ROOT/assets"
SOURCE="$ASSETS/DSH-Intel-icon.svg"
ARTWORK="$ASSETS/DSH-Intel-whale-girl.png"
ICONSET="$ROOT/.desktop-build/DSH-Intel.iconset"
OUTPUT="$ASSETS/DSH-Intel.icns"

command -v qlmanage >/dev/null || { echo "qlmanage is required to render the icon" >&2; exit 1; }
command -v sips >/dev/null || { echo "sips is required to render the icon" >&2; exit 1; }
command -v iconutil >/dev/null || { echo "iconutil is required to build the icns file" >&2; exit 1; }
[[ -f "$SOURCE" ]] || { echo "Missing icon source: $SOURCE" >&2; exit 1; }
[[ -f "$ARTWORK" ]] || { echo "Missing whale-girl artwork: $ARTWORK" >&2; exit 1; }

# Browsers do not load external images from an SVG used as an <img> source.
# Embed the artwork so the control-center icon renders the character as well as the background.
python3 - "$SOURCE" "$ARTWORK" <<'PY'
from pathlib import Path
import base64
import re
import sys

source = Path(sys.argv[1])
artwork = Path(sys.argv[2])
svg = source.read_text()
encoded = base64.b64encode(artwork.read_bytes()).decode("ascii")
pattern = r'href="(?:DSH-Intel-whale-girl\.png|data:image/png;base64,[^"]+)"'
updated, replacements = re.subn(
    pattern,
    lambda _: f'href="data:image/png;base64,{encoded}"',
    svg,
    count=1,
)
if replacements != 1:
    raise SystemExit("Could not embed the whale-girl artwork in the SVG icon")
source.write_text(updated)
PY

rm -rf "$ICONSET"
mkdir -p "$ICONSET"
qlmanage -t -s 1024 -o "$ICONSET" "$SOURCE" >/dev/null 2>&1
MASTER="$(find "$ICONSET" -maxdepth 1 -type f -name '*.png' | head -n 1)"
[[ -n "$MASTER" ]] || { echo "Could not render the SVG icon" >&2; exit 1; }

make_icon() {
  local size="$1"
  local name="$2"
  sips -z "$size" "$size" "$MASTER" --out "$ICONSET/$name" >/dev/null
}

make_icon 16 icon_16x16.png
make_icon 32 icon_16x16@2x.png
make_icon 32 icon_32x32.png
make_icon 64 icon_32x32@2x.png
make_icon 128 icon_128x128.png
make_icon 256 icon_128x128@2x.png
make_icon 256 icon_256x256.png
make_icon 512 icon_256x256@2x.png
make_icon 512 icon_512x512.png
cp "$MASTER" "$ICONSET/icon_512x512@2x.png"

iconutil --convert icns "$ICONSET" --output "$OUTPUT"
rm -rf "$ICONSET"
echo "Generated $OUTPUT"
