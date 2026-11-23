import type {
  AppConfig,
  AppUpdateState,
  ControlState,
  EnvironmentReport,
  ServiceStatus,
} from "./types.ts";
import { Logger } from "./logger.ts";
import { activeProfile, loadConfig, saveConfig } from "./config.ts";
import { detectEnvironment } from "./environment.ts";
import { DshConnection } from "./connection.ts";
import { ServiceClient } from "./service-client.ts";
import { ControlServer } from "./control-server.ts";
import type { ControlHost } from "./control-host.ts";
import { buildApplicationMenu, MENU_IDS } from "./menu.ts";
import { activateShortcut } from "./actions.ts";
import { fetchComponentVersions } from "./registry.ts";

/** Coordinates the desktop windows, managed connection, and update surfaces. */
export class AppController implements ControlHost {
  readonly #logger: Logger;
  #config: AppConfig = {
    schemaVersion: 2,
    activeProfileId: "default",
    profiles: [],
    shortcuts: [],
    updates: {
      autoCheck: true,
      checkIntervalHours: 24,
      autoUpdatePlugin: false,
      autoUpdateHarness: false,
    },
  };
  #environment: EnvironmentReport | null = null;
  #serviceStatus: ServiceStatus | null = null;
  #connection: DshConnection | null = null;
  #controlServer: ControlServer | null = null;
  #controlOrigin = "";
  #mainWindow: Deno.BrowserWindow | null = null;
  #controlWindow: Deno.BrowserWindow | null = null;
  #connected = false;
  #lastError = "";
  #appUpdate: AppUpdateState = {
    currentVersion: currentAppVersion(),
    state: "idle",
    stagedVersion: "",
    message: "尚未检查桌面应用更新",
  };
  #serviceUpdateTimer: ReturnType<typeof globalThis.setInterval> | null = null;
  #serviceUpdateRunning = false;

  constructor(logger: Logger) {
    this.#logger = logger;
  }

  /** Start the local control center and the desktop windows. */
  async start(): Promise<void> {
    this.#config = await loadConfig();
    this.#environment = await detectEnvironment();
    this.#controlServer = new ControlServer(this, this.#logger);
    this.#controlOrigin = await this.#controlServer.start();
    this.#createWindows();
    this.#startAppAutoUpdate();
    this.#scheduleServiceUpdates();
    this.#logger.info(`DSH Intel ${this.#appUpdate.currentVersion} started`);

    if (this.#isProfileConfigured(activeProfile(this.#config))) {
      await this.connect().catch((error: unknown) => {
        this.#lastError = error instanceof Error ? error.message : String(error);
        this.#logger.warn(`Initial connection failed: ${this.#lastError}`);
      });
    } else {
      this.#mainWindow?.navigate(`${this.#controlOrigin}/control/`);
      this.#mainWindow?.setTitle("DSH Intel — 设置");
    }
  }

  /** Stop background resources before the process exits. */
  async stop(): Promise<void> {
    await this.#connection?.stop();
    await this.#controlServer?.stop();
  }

  async getState(): Promise<ControlState> {
    return {
      config: this.#config,
      environment: this.#environment ?? await detectEnvironment(),
      service: this.#serviceStatus,
      appUpdate: this.#appUpdate,
      connected: this.#connected,
      lastError: this.#lastError,
    };
  }

  async saveConfig(config: AppConfig): Promise<AppConfig> {
    this.#config = config;
    await saveConfig(config);
    this.#applyMenu();
    this.#scheduleServiceUpdates();
    this.#logger.info("Configuration saved");
    return this.#config;
  }

  async connect(): Promise<{ connected: boolean; message: string }> {
    const profile = activeProfile(this.#config);
    if (!this.#isProfileConfigured(profile)) {
      this.#lastError = "请先在设置中填写服务地址或 SSH 连接信息。";
      return { connected: false, message: this.#lastError };
    }

    await this.#connection?.stop();
    this.#connection = new DshConnection(profile, this.#logger);
    try {
      const url = await this.#connection.start();
      this.#connected = true;
      this.#lastError = "";
      this.#mainWindow?.navigate(url);
      this.#mainWindow?.setTitle("DeepSeek Harness — DSH Intel");
      this.#mainWindow?.show();
      this.#mainWindow?.focus();
      await this.#refreshServiceStatus();
      return { connected: true, message: `已连接 ${url}` };
    } catch (error) {
      this.#connected = false;
      this.#lastError = error instanceof Error ? error.message : String(error);
      this.#logger.error(`Connection failed: ${this.#lastError}`);
      return { connected: false, message: this.#lastError };
    }
  }

  async openHarness(): Promise<{ connected: boolean; message: string }> {
    if (this.#connected && this.#mainWindow !== null) {
      this.#mainWindow.show();
      this.#mainWindow.focus();
      return { connected: true, message: "已打开 DeepSeek Harness" };
    }
    return await this.connect();
  }

  async update(
    component: "plugin" | "harness" | "all",
  ): Promise<{ success: boolean; message: string }> {
    const profile = activeProfile(this.#config);
    const client = new ServiceClient(profile, this.#logger);
    const operation = component === "plugin"
      ? "update-plugin"
      : component === "harness"
      ? "update-harness"
      : "update-all";
    try {
      const result = await client.update(operation);
      this.#serviceStatus = result.status ?? this.#serviceStatus;
      this.#lastError = result.success ? "" : result.message;
      return { success: result.success, message: result.message };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#lastError = message;
      return { success: false, message };
    }
  }

  async checkUpdates(): Promise<{ success: boolean; message: string }> {
    try {
      const versions = await fetchComponentVersions();
      const status = this.#serviceStatus;
      if (status !== null) {
        status.harness.latest = versions.harness;
        status.plugin.latest = versions.plugin;
      }
      this.#appUpdate = { ...this.#appUpdate, state: "checking", message: "已检查 npm 更新源" };
      this.#appUpdate = { ...this.#appUpdate, state: "idle", message: "更新检查完成" };
      return { success: true, message: "更新检查完成" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#lastError = message;
      return { success: false, message };
    }
  }

  async activateShortcut(shortcutId: string): Promise<{ success: boolean; message: string }> {
    const shortcut = this.#config.shortcuts.find((item) => item.id === shortcutId);
    if (shortcut === undefined || this.#mainWindow === null) {
      return { success: false, message: "快捷方式不存在。" };
    }
    const result = await activateShortcut(this.#mainWindow, shortcut);
    if (!result.success) this.#logger.warn(result.message);
    return result;
  }

  showControlCenter(): Promise<{ success: boolean; message: string }> {
    this.#openControlCenter();
    return Promise.resolve({ success: true, message: "控制中心已显示。" });
  }

  logs(): Promise<{ timestamp: string; level: string; message: string; detail: string }[]> {
    return Promise.resolve(this.#logger.entries());
  }

  appUpdateState(): AppUpdateState {
    return { ...this.#appUpdate };
  }

  serviceStatus(): ServiceStatus | null {
    return this.#serviceStatus;
  }

  #createWindows(): void {
    this.#mainWindow = new Deno.BrowserWindow({
      title: "DSH Intel",
      width: 1280,
      height: 840,
    });
    this.#mainWindow.setApplicationMenu(buildApplicationMenu(this.#config));
    this.#mainWindow.addEventListener("menuclick", (event) => {
      const id = (event as CustomEvent<{ id: string }>).detail.id;
      void this.#handleMenu(id);
    });
    this.#mainWindow.navigate(`${this.#controlOrigin}/control/`);

    this.#controlWindow = new Deno.BrowserWindow({
      title: "DSH Intel 控制中心",
      width: 1080,
      height: 760,
    });
    this.#controlWindow.navigate(`${this.#controlOrigin}/control/`);
  }

  #applyMenu(): void {
    this.#mainWindow?.setApplicationMenu(buildApplicationMenu(this.#config));
  }

  async #handleMenu(id: string): Promise<void> {
    if (id === MENU_IDS.openHarness) {
      await this.openHarness();
      return;
    }
    if (id === MENU_IDS.openControlCenter) {
      this.#openControlCenter();
      return;
    }
    if (id === MENU_IDS.checkUpdates) {
      const result = await this.checkUpdates();
      this.#logger.info(result.message);
      return;
    }
    if (id === MENU_IDS.reload) {
      this.#mainWindow?.reload();
      return;
    }
    if (id === MENU_IDS.devtools) {
      this.#mainWindow?.openDevtools({ renderer: true, deno: true });
      return;
    }
    if (id === MENU_IDS.about) {
      this.#openControlCenter();
      return;
    }
    if (id === MENU_IDS.quit) {
      await this.stop();
      Deno.exit(0);
    }
    if (id.startsWith(MENU_IDS.shortcutPrefix)) {
      const shortcutId = id.slice(MENU_IDS.shortcutPrefix.length);
      const shortcut = this.#config.shortcuts.find((item) => item.id === shortcutId);
      if (shortcut === undefined || this.#mainWindow === null) return;
      const result = await activateShortcut(this.#mainWindow, shortcut);
      if (!result.success) this.#logger.warn(result.message);
    }
  }

  #openControlCenter(): void {
    const window = this.#controlWindow;
    if (window === null) return;
    window.navigate(`${this.#controlOrigin}/control/`);
    window.show();
    window.focus();
  }

  #isProfileConfigured(profile: ReturnType<typeof activeProfile>): boolean {
    if (profile.transport === "https") {
      return profile.webUrl.startsWith("http://") || profile.webUrl.startsWith("https://");
    }
    return profile.ssh.host.length > 0 && profile.ssh.user.length > 0;
  }

  async #refreshServiceStatus(): Promise<void> {
    const profile = activeProfile(this.#config);
    try {
      this.#serviceStatus = await new ServiceClient(profile, this.#logger).status();
    } catch (error) {
      this.#logger.warn(
        `Service status unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  #startAppAutoUpdate(): void {
    const runtime = Deno as unknown as {
      autoUpdate?: (options: {
        url?: string;
        interval?: number;
        onUpdateReady?: (version: string) => void;
        onRollback?: (reason: string) => void;
      }) => void;
    };
    if (typeof runtime.autoUpdate !== "function") {
      this.#appUpdate = {
        ...this.#appUpdate,
        state: "unsupported",
        message: "当前进程不是 Deno Desktop 编译产物，跳过应用自更新。",
      };
      return;
    }
    runtime.autoUpdate({
      ...(this.#config.updates.autoCheck
        ? { interval: Math.max(1, this.#config.updates.checkIntervalHours) * 60 * 60 * 1000 }
        : {}),
      onUpdateReady: (version: string) => {
        this.#appUpdate = {
          ...this.#appUpdate,
          state: "ready",
          stagedVersion: version,
          message: `桌面应用 ${version} 已下载并校验，重启后生效。`,
        };
        this.#logger.info(this.#appUpdate.message);
      },
      onRollback: (reason: string) => {
        this.#appUpdate = {
          ...this.#appUpdate,
          state: "failed",
          stagedVersion: "",
          message: `更新启动失败，已回滚：${reason}`,
        };
        this.#logger.error(this.#appUpdate.message);
      },
    });
  }

  #scheduleServiceUpdates(): void {
    if (this.#serviceUpdateTimer !== null) {
      globalThis.clearInterval(this.#serviceUpdateTimer);
      this.#serviceUpdateTimer = null;
    }
    if (!this.#config.updates.autoCheck) return;
    const interval = Math.max(1, this.#config.updates.checkIntervalHours) * 60 * 60 * 1000;
    this.#serviceUpdateTimer = globalThis.setInterval(() => {
      void this.#runScheduledServiceUpdate();
    }, interval);
  }

  async #runScheduledServiceUpdate(): Promise<void> {
    if (this.#serviceUpdateRunning) return;
    this.#serviceUpdateRunning = true;
    try {
      await this.checkUpdates();
      const updates = this.#config.updates;
      const profile = activeProfile(this.#config);
      const canUpdate = profile.transport === "ssh" &&
        profile.ssh.host.length > 0 &&
        profile.ssh.user.length > 0;
      if (!canUpdate) {
        this.#logger.warn("Skipped scheduled service update because no SSH profile is configured.");
      } else if (updates.autoUpdatePlugin && updates.autoUpdateHarness) {
        await this.update("all");
      } else if (updates.autoUpdatePlugin) {
        await this.update("plugin");
      } else if (updates.autoUpdateHarness) {
        await this.update("harness");
      }
    } finally {
      this.#serviceUpdateRunning = false;
    }
  }
}

function currentAppVersion(): string {
  return typeof Deno.desktopVersion === "string" && Deno.desktopVersion
    ? Deno.desktopVersion
    : "0.1.0";
}
