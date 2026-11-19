#!/usr/bin/env bash
# Shared constants and helpers for the DSH Intel managed service.
set -euo pipefail

DSH_MI_PREFIX="${DSH_MI_PREFIX:-$HOME/.local/share/dsh-mac-intel}"
DSH_MI_HOME="${DSH_MI_HOME:-$DSH_MI_PREFIX/home}"
DSH_MI_NODE_VERSION="${DSH_MI_NODE_VERSION:-24.9.0}"
DSH_MI_NODE_SHA256="${DSH_MI_NODE_SHA256:-f52ec50e959d72d5c680d9731420b2661cd2a8070e94c7369b6ddfcd8b7278be}"
DSH_MI_PNPM_VERSION="${DSH_MI_PNPM_VERSION:-11.28.5}"
DSH_MI_DSH_VERSION="${DSH_MI_DSH_VERSION:-0.2.2-rc.5}"
DSH_MI_PLUGIN_VERSION="${DSH_MI_PLUGIN_VERSION:-2.8.5}"
DSH_MI_PLUGIN_PACKAGE="@ebony-vinyl/dsh-our-free-model"
DSH_MI_DSH_PACKAGE="@deepseek-ai/dsh"
DSH_MI_HOST="127.0.0.1"
DSH_MI_PORT="${DSH_MI_PORT:-3080}"
DSH_MI_SERVICE_NAME="dsh-mac-intel.service"
DSH_MI_CURRENT_LINK="$DSH_MI_PREFIX/current-dsh"
DSH_MI_VERSIONS_DIR="$DSH_MI_PREFIX/versions"
DSH_MI_BACKUPS_DIR="$DSH_MI_PREFIX/backups"
DSH_MI_NODE_DIR="$DSH_MI_PREFIX/node"
DSH_MI_TOOLS_DIR="$DSH_MI_PREFIX/tools"
DSH_MI_BIN_DIR="$DSH_MI_PREFIX/bin"
DSH_MI_PROFILE_DIR="$DSH_MI_HOME/profiles/web"

log() {
  printf '[dsh-mac-intel] %s\n' "$*"
}

fail() {
  printf '[dsh-mac-intel] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

node_bin() {
  printf '%s/bin/node' "$DSH_MI_NODE_DIR"
}

npm_bin() {
  printf '%s/bin/npm' "$DSH_MI_NODE_DIR"
}

pnpm_bin() {
  printf '%s/node_modules/.bin/pnpm' "$DSH_MI_TOOLS_DIR/pnpm"
}

dsh_bin() {
  printf '%s/node_modules/.bin/dsh' "$DSH_MI_CURRENT_LINK"
}

service_env() {
  printf 'DSH_HOME=%s\nPATH=%s/bin:%s/pnpm/node_modules/.bin:%s\n' \
    "$DSH_MI_HOME" "$DSH_MI_NODE_DIR" "$DSH_MI_TOOLS_DIR" "$PATH"
}

health_check() {
  curl --fail --silent --show-error --max-time 5 "http://$DSH_MI_HOST:$DSH_MI_PORT/" >/dev/null
}

wait_for_health() {
  local attempts="${1:-30}"
  local index
  for ((index = 1; index <= attempts; index += 1)); do
    if health_check; then
      return 0
    fi
    sleep 1
  done
  return 1
}

restart_service() {
  systemctl --user daemon-reload
  systemctl --user restart "$DSH_MI_SERVICE_NAME"
  wait_for_health 30 || fail "DSH web service did not become healthy after restart"
}

installed_dsh_version() {
  local manifest="$DSH_MI_CURRENT_LINK/node_modules/@deepseek-ai/dsh/package.json"
  [[ -f "$manifest" ]] || return 0
  "$(node_bin)" -e 'const fs=require("node:fs"); const p=process.argv[1]; console.log(JSON.parse(fs.readFileSync(p,"utf8")).version || "")' "$manifest"
}

installed_plugin_version() {
  local package_manifest="$DSH_MI_PROFILE_DIR/node_modules/@ebony-vinyl/dsh-our-free-model/package.json"
  if [[ -f "$package_manifest" ]]; then
    "$(node_bin)" -e 'const fs=require("node:fs"); console.log(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).version || "")' "$package_manifest"
    return
  fi
  local manifest="$DSH_MI_PROFILE_DIR/package.json"
  [[ -f "$manifest" ]] || return 0
  "$(node_bin)" -e '
    const fs=require("node:fs");
    const manifest=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    const spec=process.argv[2];
    const value=manifest.dependencies?.[spec] || manifest.devDependencies?.[spec] || "";
    console.log(String(value).replace(/^[^0-9]*/,""));
  ' "$manifest" "$DSH_MI_PLUGIN_PACKAGE"
}

latest_npm_version() {
  local package="$1"
  NPM_CONFIG_REGISTRY="${NPM_CONFIG_REGISTRY:-https://registry.npmjs.org}" \
    "$(npm_bin)" view "$package" version --silent
}

version_is_newer() {
  local candidate="$1"
  local current="$2"
  [[ -n "$candidate" ]] || return 1
  [[ -n "$current" ]] || return 0
  "$(node_bin)" -e '
    const parse=(v)=>{const [c="",p=""]=v.replace(/^v/,"").split("-",2);return {c:c.split(".").map(x=>Number.parseInt(x)||0),p:p?p.split("."):[]}};
    const cmp=(a,b)=>{for(let i=0;i<Math.max(a.c.length,b.c.length);i++){const d=(a.c[i]||0)-(b.c[i]||0);if(d)return d<0?-1:1}if(!a.p.length&&!b.p.length)return 0;if(!a.p.length)return 1;if(!b.p.length)return -1;for(let i=0;i<Math.max(a.p.length,b.p.length);i++){if(a.p[i]===undefined)return -1;if(b.p[i]===undefined)return 1;const an=/^\\d+$/.test(a.p[i]),bn=/^\\d+$/.test(b.p[i]);if(an&&bn){const d=Number(a.p[i])-Number(b.p[i]);if(d)return d<0?-1:1}else if(an!==bn)return an?-1:1;else if(a.p[i]!==b.p[i])return a.p[i]<b.p[i]?-1:1}return 0};
    process.exit(cmp(parse(process.argv[1]),parse(process.argv[2]))>0?0:1);
  ' "$candidate" "$current"
}

json_status() {
  local installed_harness="$1"
  local latest_harness="$2"
  local installed_plugin="$3"
  local latest_plugin="$4"
  local active="$5"
  local healthy="$6"
  local node_version="$7"
  local message="$8"
  DSH_STATUS_INSTALLED_HARNESS="$installed_harness" \
  DSH_STATUS_LATEST_HARNESS="$latest_harness" \
  DSH_STATUS_INSTALLED_PLUGIN="$installed_plugin" \
  DSH_STATUS_LATEST_PLUGIN="$latest_plugin" \
  DSH_STATUS_ACTIVE="$active" \
  DSH_STATUS_HEALTHY="$healthy" \
  DSH_STATUS_NODE_VERSION="$node_version" \
  DSH_STATUS_MESSAGE="$message" \
  "$(node_bin)" -e '
    const cmp=(a,b)=>{if(!a)return false;if(!b)return true;const p=v=>{const [c="",p=""]=v.split("-",2);return {c:c.split(".").map(x=>Number.parseInt(x)||0),p:p?p.split("."):[]}};const x=p(a),y=p(b);for(let i=0;i<Math.max(x.c.length,y.c.length);i++){const d=(x.c[i]||0)-(y.c[i]||0);if(d)return d>0}if(!x.p.length&&!y.p.length)return false;if(!x.p.length)return true;if(!y.p.length)return false;return a.localeCompare(b,undefined,{numeric:true})>0};
    const installedH=process.env.DSH_STATUS_INSTALLED_HARNESS||"";
    const installedP=process.env.DSH_STATUS_INSTALLED_PLUGIN||"";
    console.log(JSON.stringify({
      ok:process.env.DSH_STATUS_HEALTHY==="true",
      service:{active:process.env.DSH_STATUS_ACTIVE==="true",url:`http://${process.env.DSH_STATUS_HOST||"127.0.0.1"}:${process.env.DSH_STATUS_PORT||"3080"}`},
      node:{version:process.env.DSH_STATUS_NODE_VERSION||""},
      harness:{installed:installedH,latest:process.env.DSH_STATUS_LATEST_HARNESS||"",updateAvailable:cmp(process.env.DSH_STATUS_LATEST_HARNESS||"",installedH)},
      plugin:{installed:installedP,latest:process.env.DSH_STATUS_LATEST_PLUGIN||"",updateAvailable:cmp(process.env.DSH_STATUS_LATEST_PLUGIN||"",installedP)},
      message:process.env.DSH_STATUS_MESSAGE||""
    }));
  '
}
