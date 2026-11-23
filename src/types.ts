/** Public package identifiers used by the desktop shell and managed service. */
export const DSH_PACKAGE = "@deepseek-ai/dsh" as const;
export const OFM_PACKAGE = "@ebony-vinyl/dsh-our-free-model" as const;

/**
 * Versions bundled with the first service release.
 *
 * They are bootstrap fallbacks, not permanent pins: the update service checks
 * npm on every explicit or scheduled update and keeps the newer verified
 * version when one is available.
 */
export const DSH_BOOTSTRAP_VERSION = "0.2.2-rc.5" as const;
export const OFM_BOOTSTRAP_VERSION = "2.8.5" as const;

/** How the desktop shell reaches the always-on DSH web service. */
export type ProfileTransport = "ssh" | "https";

/** SSH tunnel and managed-service settings for a remote DSH installation. */
export interface SshProfile {
  host: string;
  user: string;
  port: number;
  identityFile: string;
  remotePort: number;
  localPort: number;
  servicePath: string;
}

/** A named endpoint that can host the official DSH web application. */
export interface AppProfile {
  id: string;
  name: string;
  transport: ProfileTransport;
  webUrl: string;
  ssh: SshProfile;
}

/** Supported targets for a shortcut in the native menu and control center. */
export type ShortcutKind = "panel" | "text" | "url";

/** One user-visible shortcut into the official DSH web interface. */
export interface Shortcut {
  id: string;
  label: string;
  group: string;
  kind: ShortcutKind;
  target: string;
  matchText: string[];
  url: string;
}

/** Update preferences shared by the shell and the managed service. */
export interface UpdateSettings {
  autoCheck: boolean;
  checkIntervalHours: number;
  autoUpdatePlugin: boolean;
  autoUpdateHarness: boolean;
}

/** Persisted application configuration. */
export interface AppConfig {
  schemaVersion: 2;
  activeProfileId: string;
  profiles: AppProfile[];
  shortcuts: Shortcut[];
  updates: UpdateSettings;
}

/** A single environment compatibility finding. */
export interface EnvironmentFinding {
  id: string;
  label: string;
  status: "ok" | "warning" | "error" | "unknown";
  detail: string;
  required: boolean;
}

/** Aggregated local and remote environment report. */
export interface EnvironmentReport {
  platform: string;
  architecture: string;
  denoVersion: string;
  nodeVersion: string;
  sshAvailable: boolean;
  findings: EnvironmentFinding[];
}

/** Version state for one updateable component. */
export interface ComponentVersion {
  installed: string;
  latest: string;
  updateAvailable: boolean;
}

/** Status returned by the managed service. */
export interface ServiceStatus {
  ok: boolean;
  service: {
    active: boolean;
    url: string;
  };
  node: {
    version: string;
  };
  harness: ComponentVersion;
  plugin: ComponentVersion;
  message: string;
}

/** State of the desktop shell's own Deno auto-update mechanism. */
export interface AppUpdateState {
  currentVersion: string;
  state: "idle" | "checking" | "ready" | "applied" | "failed" | "unsupported";
  stagedVersion: string;
  message: string;
}

/** Aggregated state rendered by the local control center. */
export interface ControlState {
  config: AppConfig;
  environment: EnvironmentReport;
  service: ServiceStatus | null;
  appUpdate: AppUpdateState;
  connected: boolean;
  lastError: string;
}
