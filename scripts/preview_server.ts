import type { ControlHost } from "../src/control-host.ts";
import { ControlServer } from "../src/control-server.ts";
import { Logger } from "../src/logger.ts";
import { defaultConfig } from "../src/config.ts";
import {
  type AppConfig,
  type AppUpdateState,
  type ControlState,
  DSH_BOOTSTRAP_VERSION,
  type EnvironmentReport,
  OFM_BOOTSTRAP_VERSION,
  type ServiceStatus,
} from "../src/types.ts";

/** Deterministic, non-connected state used to capture the real control-center UI. */
class PreviewHost implements ControlHost {
  #config = defaultConfig();

  getState(): Promise<ControlState> {
    const environment: EnvironmentReport = {
      platform: "darwin x86_64",
      architecture: "x86_64",
      denoVersion: "2.9.7",
      nodeVersion: "",
      sshAvailable: true,
      findings: [
        {
          id: "platform",
          label: "运行平台",
          status: "ok",
          detail: "macOS Intel (x86_64)",
          required: true,
        },
        {
          id: "deno",
          label: "Deno 运行时",
          status: "ok",
          detail: "2.9.7；桌面应用已内置运行时",
          required: true,
        },
        {
          id: "node",
          label: "Node.js",
          status: "warning",
          detail: "未检测到 Node.js；桌面端无需安装，远程服务脚本可自动下载隔离运行时",
          required: false,
        },
        {
          id: "ssh",
          label: "SSH 客户端",
          status: "ok",
          detail: "可用于连接常驻 DSH 服务及执行安全更新命令",
          required: false,
        },
      ],
    };
    const service: ServiceStatus = {
      ok: false,
      service: { active: false, url: "http://127.0.0.1:3080" },
      node: { version: "" },
      harness: {
        installed: "未连接",
        latest: DSH_BOOTSTRAP_VERSION,
        updateAvailable: false,
      },
      plugin: {
        installed: "未连接",
        latest: OFM_BOOTSTRAP_VERSION,
        updateAvailable: false,
      },
      message: "预览模式：尚未连接常驻服务。",
    };
    const appUpdate: AppUpdateState = {
      currentVersion: "0.1.0",
      state: "idle",
      stagedVersion: "",
      message: "等待检查 GitHub Releases 更新",
    };
    return Promise.resolve({
      config: this.#config,
      environment,
      service,
      appUpdate,
      connected: false,
      lastError: "",
    });
  }

  saveConfig(config: AppConfig): Promise<AppConfig> {
    this.#config = config;
    return Promise.resolve(config);
  }

  connect(): Promise<{ connected: boolean; message: string }> {
    return Promise.resolve({ connected: false, message: "预览模式不建立远程连接。" });
  }

  openHarness(): Promise<{ connected: boolean; message: string }> {
    return Promise.resolve({ connected: false, message: "预览模式不打开远程 Harness。" });
  }

  update(): Promise<{ success: boolean; message: string }> {
    return Promise.resolve({ success: false, message: "预览模式不执行更新。" });
  }

  checkUpdates(): Promise<{ success: boolean; message: string }> {
    return Promise.resolve({ success: true, message: "预览模式已显示内置版本信息。" });
  }

  activateShortcut(): Promise<{ success: boolean; message: string }> {
    return Promise.resolve({ success: false, message: "预览模式不操作远程 Harness。" });
  }

  showControlCenter(): Promise<{ success: boolean; message: string }> {
    return Promise.resolve({ success: true, message: "已经是控制中心。" });
  }

  logs(): Promise<{ timestamp: string; level: string; message: string; detail: string }[]> {
    return Promise.resolve([]);
  }

  appUpdateState(): AppUpdateState {
    return {
      currentVersion: "0.1.0",
      state: "idle",
      stagedVersion: "",
      message: "等待检查 GitHub Releases 更新",
    };
  }

  serviceStatus(): ServiceStatus | null {
    return null;
  }
}

const portArgument = Deno.args.find((argument) => argument.startsWith("--port="));
const port = Number(portArgument?.split("=")[1] ?? "4173");
const server = new ControlServer(new PreviewHost(), new Logger());
const origin = await server.start(Number.isFinite(port) ? port : 4173);
console.log(`DSH Intel control-center preview: ${origin}/control/`);
await new Promise(() => {});
