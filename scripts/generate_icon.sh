#!/usr/bin/env bash
# Generate the macOS .icns asset from the upstream DeepSeek Harness mark.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ASSETS="$ROOT/assets"
SOURCE="$ASSETS/DSH-Intel-icon.svg"
ICONSET="$ROOT/.desktop-build/DSH-Intel.iconset"
OUTPUT="$ASSETS/DSH-Intel.icns"

command -v qlmanage >/dev/null || { echo "qlmanage is required to render the icon" >&2; exit 1; }
command -v sips >/dev/null || { echo "sips is required to render the icon" >&2; exit 1; }
command -v iconutil >/dev/null || { echo "iconutil is required to build the icns file" >&2; exit 1; }

python3 - "$ASSETS/dsh-mark.svg" "$SOURCE" <<'PY'
from pathlib import Path
import sys
source = Path(sys.argv[1]).read_text()
source = source.replace('fill="#000"', 'fill="#ffffff"')
source = source.replace('width="50.000000" height="50.000000"', 'width="1024" height="1024"')
source = source.replace(
    'fill="none">',
    'fill="none"><rect x="1" y="1" width="48" height="48" rx="11" fill="#4176e6"/>',
    1,
)
Path(sys.argv[2]).write_text(source)
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
