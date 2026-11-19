#!/usr/bin/env bash
# Install the always-on DSH web service and its default Our Free Model plugin.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

require_command curl
require_command tar
require_command systemctl

if [[ "$(uname -s)" != "Linux" || "$(uname -m)" != "x86_64" ]]; then
  fail "The managed DSH service currently targets Linux x86_64"
fi

mkdir -p "$DSH_MI_PREFIX" "$DSH_MI_HOME" "$DSH_MI_VERSIONS_DIR" "$DSH_MI_BACKUPS_DIR" \
  "$DSH_MI_BIN_DIR" "$DSH_MI_TOOLS_DIR" "$DSH_MI_PREFIX/plugins"

install_node() {
  if [[ -x "$(node_bin)" ]] && "$("$(node_bin)" --version)" == "v$DSH_MI_NODE_VERSION"; then
    log "Node.js $DSH_MI_NODE_VERSION is already installed"
    return
  fi
  local archive="$DSH_MI_PREFIX/node-v$DSH_MI_NODE_VERSION-linux-x64.tar.xz"
  local url="https://nodejs.org/dist/v$DSH_MI_NODE_VERSION/node-v$DSH_MI_NODE_VERSION-linux-x64.tar.xz"
  log "Downloading the isolated Node.js $DSH_MI_NODE_VERSION runtime"
  curl --fail --location --retry 3 --output "$archive" "$url"
  printf '%s  %s\n' "$DSH_MI_NODE_SHA256" "$archive" | sha256sum --check --status \
    || fail "Node.js archive checksum verification failed"
  rm -rf "$DSH_MI_NODE_DIR"
  mkdir -p "$DSH_MI_NODE_DIR"
  tar -xJf "$archive" --strip-components=1 -C "$DSH_MI_NODE_DIR"
  rm -f "$archive"
}

install_pnpm() {
  if [[ -x "$(pnpm_bin)" ]] && "$("$(pnpm_bin)" --version)" == "$DSH_MI_PNPM_VERSION"; then
    log "pnpm $DSH_MI_PNPM_VERSION is already installed"
    return
  fi
  log "Installing pnpm $DSH_MI_PNPM_VERSION in the isolated tools directory"
  NPM_CONFIG_REGISTRY="${NPM_CONFIG_REGISTRY:-https://registry.npmjs.org}" \
    "$(npm_bin)" install --prefix "$DSH_MI_TOOLS_DIR/pnpm" --no-audit --no-fund \
      "pnpm@$DSH_MI_PNPM_VERSION"
}

install_harness() {
  local destination="$DSH_MI_VERSIONS_DIR/dsh-$DSH_MI_DSH_VERSION"
  if [[ ! -x "$destination/node_modules/.bin/dsh" ]]; then
    log "Installing DeepSeek Harness $DSH_MI_DSH_VERSION"
    NPM_CONFIG_REGISTRY="${NPM_CONFIG_REGISTRY:-https://registry.npmjs.org}" \
      "$(npm_bin)" install --prefix "$destination" --no-audit --no-fund \
        "$DSH_MI_DSH_PACKAGE@$DSH_MI_DSH_VERSION"
  fi
  ln -sfn "$destination" "$DSH_MI_CURRENT_LINK"
}

install_plugin() {
  local bundled_plugin spec
  bundled_plugin="$(find "$SCRIPT_DIR/plugins" -maxdepth 1 -type f -name 'dsh-our-free-model-*.tgz' 2>/dev/null | sort | tail -n 1 || true)"
  if [[ -n "$bundled_plugin" ]]; then
    install -m 0644 "$bundled_plugin" "$DSH_MI_PREFIX/plugins/$(basename "$bundled_plugin")"
    # The profile lives at $DSH_MI_HOME/profiles/web; this relative path remains
    # valid after the service prefix is moved or restored.
    spec="../../../plugins/$(basename "$bundled_plugin")"
    log "Installing the bundled Our Free Model plugin from $spec"
  else
    spec="$DSH_MI_PLUGIN_PACKAGE@$DSH_MI_PLUGIN_VERSION"
    log "Installing the default Our Free Model plugin ($DSH_MI_PLUGIN_VERSION) from npm"
  fi
  (
    export DSH_HOME="$DSH_MI_HOME"
    export PATH="$DSH_MI_NODE_DIR/bin:$DSH_MI_TOOLS_DIR/pnpm/node_modules/.bin:$PATH"
    mkdir -p "$DSH_MI_PROFILE_DIR"
    cd "$DSH_MI_PROFILE_DIR"
    "$(dsh_bin)" plugin --profile web add "$spec"
  )
}

install_service_files() {
  install -m 0755 "$SCRIPT_DIR/bin/dsh-mac-intel-service" "$DSH_MI_BIN_DIR/dsh-mac-intel-service"
  install -m 0644 "$SCRIPT_DIR/lib.sh" "$DSH_MI_PREFIX/lib.sh"
  mkdir -p "$HOME/.config/systemd/user"
  sed \
    -e "s|__PREFIX__|$DSH_MI_PREFIX|g" \
    -e "s|__DSH_HOME__|$DSH_MI_HOME|g" \
    -e "s|__NODE_BIN__|$DSH_MI_NODE_DIR/bin|g" \
    -e "s|__PNPM_BIN__|$DSH_MI_TOOLS_DIR/pnpm/node_modules/.bin|g" \
    -e "s|__DSH_BIN__|$DSH_MI_CURRENT_LINK/node_modules/.bin/dsh|g" \
    -e "s|__HOST__|$DSH_MI_HOST|g" \
    -e "s|__PORT__|$DSH_MI_PORT|g" \
    "$SCRIPT_DIR/systemd/dsh-mac-intel.service" > "$HOME/.config/systemd/user/$DSH_MI_SERVICE_NAME"
}

enable_service() {
  systemctl --user daemon-reload
  systemctl --user enable --now "$DSH_MI_SERVICE_NAME"
  if ! systemctl --user is-active --quiet "$DSH_MI_SERVICE_NAME"; then
    systemctl --user --no-pager --full status "$DSH_MI_SERVICE_NAME" || true
    fail "The DSH service did not start"
  fi
  if command -v loginctl >/dev/null 2>&1; then
    loginctl enable-linger "$USER" >/dev/null 2>&1 \
      || log "Could not enable systemd linger automatically; run: sudo loginctl enable-linger $USER"
  fi
}

install_node
install_pnpm
install_harness
install_plugin
install_service_files
enable_service

log "Installation complete"
log "DSH web: http://$DSH_MI_HOST:$DSH_MI_PORT"
log "Status: $DSH_MI_BIN_DIR/dsh-mac-intel-service status"
log "Updates: $DSH_MI_BIN_DIR/dsh-mac-intel-service update-all"
