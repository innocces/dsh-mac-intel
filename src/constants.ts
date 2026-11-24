/** Official DeepSeek Harness web listener defaults. */
export const DSH_WEB_HOST = "127.0.0.1" as const;
export const DSH_WEB_PORT = 3080 as const;

/** OpenSSH's default connection port. */
export const SSH_PORT = 22 as const;

/** Installation path used by the DSH Intel managed-service package. */
export const MANAGED_SERVICE_PATH =
  "~/.local/share/dsh-mac-intel/bin/dsh-mac-intel-service" as const;
