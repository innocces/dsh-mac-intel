import type { AppProfile, ServiceStatus } from "./types.ts";
import { Logger } from "./logger.ts";
import { fetchComponentVersions } from "./registry.ts";
import { type ServiceOperation, SshClient } from "./ssh.ts";
import { waitForHttp } from "./connection.ts";

/** Result returned after a managed update operation. */
export interface UpdateResult {
  success: boolean;
  message: string;
  status: ServiceStatus | null;
}

/** Read status and request updates through the managed service boundary. */
export class ServiceClient {
  readonly #profile: AppProfile;
  readonly #logger: Logger;

  constructor(profile: AppProfile, logger: Logger) {
    this.#profile = profile;
    this.#logger = logger;
  }

  /** Read the current service, DSH, and plugin versions. */
  async status(): Promise<ServiceStatus> {
    if (this.#profile.transport === "ssh") {
      if (!this.#profile.ssh.host) {
        throw new Error("请先在连接设置中填写 SSH 服务器或 OpenSSH 主机别名。");
      }
      const result = await new SshClient(this.#profile, this.#logger).service("status");
      if (!result.success || result.status === null) {
        throw new Error(
          result.stderr || result.stdout || "The managed service did not return status",
        );
      }
      return result.status;
    }

    const reachable = await waitForHttp(this.#profile.webUrl, 3_000);
    const versions = await fetchComponentVersions().catch(() => ({
      harness: "unknown",
      plugin: "unknown",
    }));
    return {
      ok: reachable,
      service: {
        active: reachable,
        url: this.#profile.webUrl,
      },
      node: { version: "managed remotely" },
      harness: {
        installed: "managed remotely",
        latest: versions.harness,
        updateAvailable: false,
      },
      plugin: {
        installed: "managed remotely",
        latest: versions.plugin,
        updateAvailable: false,
      },
      message: reachable
        ? "HTTPS endpoint is reachable; use the managed SSH profile for one-click updates."
        : "HTTPS endpoint is not reachable.",
    };
  }

  /** Apply an update through the managed service helper. */
  async update(operation: Exclude<ServiceOperation, "status">): Promise<UpdateResult> {
    if (this.#profile.transport !== "ssh") {
      return {
        success: false,
        message:
          "One-click updates require an SSH profile with the dsh-mac-intel-service helper installed.",
        status: null,
      };
    }
    if (!this.#profile.ssh.host) {
      return {
        success: false,
        message: "请先在连接设置中填写 SSH 服务器或 OpenSSH 主机别名。",
        status: null,
      };
    }
    const result = await new SshClient(this.#profile, this.#logger).service(operation);
    const message = result.success
      ? `${operation} completed successfully.`
      : result.stderr || result.stdout || `${operation} failed.`;
    this.#logger.info(message);
    const status = await this.status().catch(() => null);
    return { success: result.success, message, status };
  }
}
