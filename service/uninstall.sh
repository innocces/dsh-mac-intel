#!/usr/bin/env bash
# Stop and remove the DSH Intel managed service.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

if systemctl --user is-active --quiet "$DSH_MI_SERVICE_NAME" 2>/dev/null; then
  log "Stopping $DSH_MI_SERVICE_NAME"
  systemctl --user stop "$DSH_MI_SERVICE_NAME"
fi
systemctl --user disable "$DSH_MI_SERVICE_NAME" 2>/dev/null || true
rm -f "$HOME/.config/systemd/user/$DSH_MI_SERVICE_NAME"
systemctl --user daemon-reload

if [[ "${1:-}" == "--purge" ]]; then
  log "Removing runtime files from $DSH_MI_PREFIX"
  rm -rf "$DSH_MI_PREFIX"
else
  log "Runtime files were kept in $DSH_MI_PREFIX"
  log "Use --purge to remove the runtime, plugin profile, and version backups"
fi

log "Uninstall complete"
