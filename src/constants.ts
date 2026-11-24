/** Official DeepSeek Harness web listener defaults. */
export const DSH_WEB_HOST = "127.0.0.1" as const;
export const DSH_WEB_PORT = 3080 as const;

/** OpenSSH's default connection port. */
export const SSH_PORT = 22 as const;

/** Installation path used by the DSH Intel managed-service package. */
export const MANAGED_SERVICE_PATH =
  "~/.local/share/dsh-mac-intel/bin/dsh-mac-intel-service" as const;

/** Isolated Node.js runtime used by the optional macOS local service. */
export const LOCAL_NODE_VERSION = "24.9.0" as const;
export const LOCAL_NODE_ARCHIVE = `node-v${LOCAL_NODE_VERSION}-darwin-x64.tar.gz` as const;
export const LOCAL_NODE_URL =
  `https://nodejs.org/dist/v${LOCAL_NODE_VERSION}/${LOCAL_NODE_ARCHIVE}` as const;
export const LOCAL_NODE_SHA256 =
  "6c9ac12d3160538d96d456dc59a8fec1479e3f8b20bfc0d61bc809eb9ec11417" as const;

/** LaunchAgent identity for the optional macOS local service. */
export const LOCAL_SERVICE_LABEL = "com.innocces.dsh-mac-intel.service" as const;

/** LaunchAgent identity for periodic local-service storage cleanup. */
export const LOCAL_CLEANUP_LABEL = "com.innocces.dsh-mac-intel.cleanup" as const;

/** Maximum size of temporary files retained by the isolated local service. */
export const LOCAL_TEMP_MAX_BYTES = 1024 * 1024 * 1024;

/** Age after which failed update artifacts may be removed. */
export const LOCAL_TEMP_STALE_MS = 24 * 60 * 60 * 1000;

/** Grace period during which an active temporary download is not removed. */
export const LOCAL_TEMP_ACTIVE_GRACE_MS = 10 * 60 * 1000;

/** Interval between periodic storage-cleanup runs. */
export const LOCAL_CLEANUP_INTERVAL_SECONDS = 300;

/** Free space required before installing or updating the local runtime. */
export const LOCAL_INSTALL_MIN_FREE_BYTES = 2 * 1024 * 1024 * 1024;
