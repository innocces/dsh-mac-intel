import type { AppProfile, ServiceStatus } from "./types.ts";
import { Logger } from "./logger.ts";

/** Managed-service operations accepted by the remote helper script. */
export type ServiceOperation = "status" | "update-plugin" | "update-harness" | "update-all";

/** Result of a remote managed-service command. */
export interface ServiceCommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  status: ServiceStatus | null;
}

/** Execute a small, fixed set of operations over SSH. */
export class SshClient {
  readonly #profile: AppProfile;
  readonly #logger: Logger;

  constructor(profile: AppProfile, logger: Logger) {
    this.#profile = profile;
    this.#logger = logger;
  }

  /** Run the managed-service helper with an allow-listed operation. */
  async service(operation: ServiceOperation): Promise<ServiceCommandResult> {
    const servicePath = this.#profile.ssh.servicePath;
    const result = await this.#run([servicePath, operation]);
    const status = operation === "status" ? parseServiceStatus(result.stdout) : null;
    return { ...result, status };
  }

  /** Start a local SSH forward and resolve when the remote web port answers. */
  startTunnel(localPort: number): Promise<Deno.ChildProcess> {
    const args = [
      ...this.#baseArgs(),
      "-N",
      "-T",
      "-o",
      "ExitOnForwardFailure=yes",
      "-o",
      "ServerAliveInterval=30",
      "-o",
      "ServerAliveCountMax=3",
      "-L",
      `127.0.0.1:${localPort}:127.0.0.1:${this.#profile.ssh.remotePort}`,
      this.#target(),
    ];
    this.#logger.info(`Starting SSH tunnel to ${this.#target()}:${this.#profile.ssh.remotePort}`);
    const process = new Deno.Command("ssh", {
      args,
      stdin: "null",
      stdout: "null",
      stderr: "piped",
    }).spawn();

    void this.#consumeStderr(process);
    return Promise.resolve(process);
  }

  async #run(command: string[]): Promise<{ success: boolean; stdout: string; stderr: string }> {
    const args = [...this.#baseArgs(), ...command, this.#target()];
    try {
      const output = await new Deno.Command("ssh", {
        args,
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
      }).output();
      const stdout = new TextDecoder().decode(output.stdout).trim();
      const stderr = new TextDecoder().decode(output.stderr).trim();
      return { success: output.success, stdout, stderr };
    } catch (error) {
      return {
        success: false,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
      };
    }
  }

  #baseArgs(): string[] {
    const args = [
      "-p",
      String(this.#profile.ssh.port),
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "-o",
      "StrictHostKeyChecking=accept-new",
    ];
    if (this.#profile.ssh.identityFile) {
      args.push("-i", this.#profile.ssh.identityFile);
    }
    return args;
  }

  #target(): string {
    return `${this.#profile.ssh.user}@${this.#profile.ssh.host}`;
  }

  async #consumeStderr(process: Deno.ChildProcess): Promise<void> {
    if (process.stderr === null) return;
    const decoder = new TextDecoder();
    try {
      for await (const chunk of process.stderr) {
        const message = decoder.decode(chunk, { stream: true }).trim();
        if (message) this.#logger.warn(`SSH tunnel: ${message}`);
      }
    } catch {
      // The process may be killed while the stream is being drained.
    }
  }
}

/** Parse the JSON document emitted by the managed-service status command. */
export function parseServiceStatus(output: string): ServiceStatus | null {
  const trimmed = output.trim();
  if (!trimmed) return null;
  const candidates = trimmed.split("\n").reverse();
  for (const candidate of candidates) {
    const text = candidate.trim();
    if (!text.startsWith("{")) continue;
    try {
      const value = JSON.parse(text) as unknown;
      if (isRecord(value) && typeof value.ok === "boolean") {
        return value as unknown as ServiceStatus;
      }
    } catch {
      // Try the preceding line: the helper always emits JSON on its own line.
    }
  }
  try {
    const value = JSON.parse(trimmed) as unknown;
    return isRecord(value) && typeof value.ok === "boolean"
      ? value as unknown as ServiceStatus
      : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
