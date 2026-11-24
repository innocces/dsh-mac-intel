import type { AppProfile, ServiceStatus } from "./types.ts";
import { Logger } from "./logger.ts";
import { SSH_PORT } from "./constants.ts";

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
      ...buildSshBaseArgs(this.#profile),
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
      buildSshTarget(this.#profile),
    ];
    const target = buildSshTarget(this.#profile);
    this.#logger.info(`Starting SSH tunnel to ${target}:${this.#profile.ssh.remotePort}`);
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
    const args = buildSshCommandArgs(this.#profile, command);
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

/** Build an OpenSSH command with the destination before the remote command. */
export function buildSshCommandArgs(
  profile: AppProfile,
  remoteCommand: string[] = [],
): string[] {
  return [
    ...buildSshBaseArgs(profile),
    buildSshTarget(profile),
    ...remoteCommand,
  ];
}

/**
 * Build an OpenSSH destination.
 *
 * An explicit user is optional so an existing `Host` alias can own its user,
 * identity file, port, and known-host configuration in `~/.ssh/config`.
 */
export function buildSshTarget(profile: AppProfile): string {
  const user = profile.ssh.user.trim();
  return user ? `${user}@${profile.ssh.host}` : profile.ssh.host;
}

/** Build the shared OpenSSH options for tunnels and managed-service commands. */
function buildSshBaseArgs(profile: AppProfile): string[] {
  const args: string[] = [];
  if (profile.ssh.port !== SSH_PORT) {
    args.push("-p", String(profile.ssh.port));
  }
  args.push(
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "StrictHostKeyChecking=accept-new",
  );
  if (profile.ssh.identityFile) {
    args.push("-i", expandHomePath(profile.ssh.identityFile));
  }
  return args;
}

/** Expand a local home-relative identity-file path before passing it to OpenSSH. */
function expandHomePath(path: string): string {
  if (path !== "~" && !path.startsWith("~/")) return path;
  const home = Deno.env.get("HOME");
  if (!home) return path;
  return path === "~" ? home : `${home}/${path.slice(2)}`;
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
