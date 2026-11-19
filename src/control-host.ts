import type { AppConfig, AppUpdateState, ControlState, ServiceStatus } from "./types.ts";

/** Operations exposed by the application to the local control-center server. */
export interface ControlHost {
  /** Return the complete state rendered by the control center. */
  getState(): Promise<ControlState>;
  /** Validate and persist a new configuration. */
  saveConfig(config: AppConfig): Promise<AppConfig>;
  /** Reconnect using the active profile. */
  connect(): Promise<{ connected: boolean; message: string }>;
  /** Open the official DSH web application. */
  openHarness(): Promise<{ connected: boolean; message: string }>;
  /** Run a managed update operation. */
  update(component: "plugin" | "harness" | "all"): Promise<{ success: boolean; message: string }>;
  /** Refresh remote and registry version information. */
  checkUpdates(): Promise<{ success: boolean; message: string }>;
  /** Activate a configured shortcut in the official DSH web window. */
  activateShortcut(shortcutId: string): Promise<{ success: boolean; message: string }>;
  /** Bring the dedicated control-center window to the foreground. */
  showControlCenter(): Promise<{ success: boolean; message: string }>;
  /** Return recent diagnostic entries. */
  logs(): Promise<{ timestamp: string; level: string; message: string; detail: string }[]>;
  /** Return the desktop app's self-update state. */
  appUpdateState(): AppUpdateState;
  /** Return the latest known managed-service status. */
  serviceStatus(): ServiceStatus | null;
}
