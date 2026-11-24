import type { AppProfile } from "./types.ts";
import { Logger } from "./logger.ts";
import { SshClient } from "./ssh.ts";
import { DSH_WEB_HOST } from "./constants.ts";

/** A live connection to the official DSH web application. */
export class DshConnection {
  readonly #profile: AppProfile;
  readonly #logger: Logger;
  #tunnel: Deno.ChildProcess | null = null;
  #url = "";

  constructor(profile: AppProfile, logger: Logger) {
    this.#profile = profile;
    this.#logger = logger;
  }

  /** Start the connection and return the URL that should be opened. */
  async start(): Promise<string> {
    if (this.#profile.transport === "https") {
      this.#url = this.#profile.webUrl;
      await this.#assertReachable(this.#url);
      this.#logger.info(`DSH web endpoint is ${this.#url}`);
      return this.#url;
    }

    const localPort = await findAvailablePort(this.#profile.ssh.localPort);
    const client = new SshClient(this.#profile, this.#logger);
    this.#tunnel = await client.startTunnel(localPort);
    this.#url = `http://${DSH_WEB_HOST}:${localPort}`;
    const ready = await waitForHttp(this.#url, 12_000);
    if (!ready) {
      await this.stop();
      throw new Error(`SSH tunnel did not expose the DSH web service at ${this.#url}`);
    }
    this.#logger.info(`DSH web endpoint is ${this.#url} through ${this.#profile.ssh.host}`);
    return this.#url;
  }

  /** Return the currently active web URL. */
  get url(): string {
    return this.#url;
  }

  /** Stop the tunnel, if one is running. */
  async stop(): Promise<void> {
    const tunnel = this.#tunnel;
    this.#tunnel = null;
    if (tunnel === null) return;
    try {
      tunnel.kill("SIGTERM");
      await tunnel.status;
    } catch {
      // The process may already have exited.
    }
  }

  async #assertReachable(url: string): Promise<void> {
    const reachable = await waitForHttp(url, 4_000);
    if (!reachable) throw new Error(`DSH web endpoint is not reachable: ${url}`);
  }
}

/** Find a free TCP port, beginning at the preferred port. */
export async function findAvailablePort(preferred: number): Promise<number> {
  const start = Math.min(65_535, Math.max(1024, preferred));
  for (let offset = 0; offset < 200; offset += 1) {
    const candidate = start + offset;
    if (candidate > 65_535) break;
    try {
      const listener = await Deno.listen({ hostname: "127.0.0.1", port: candidate });
      listener.close();
      return candidate;
    } catch (error) {
      if (!(error instanceof Deno.errors.AddrInUse)) throw error;
    }
  }
  throw new Error(`No free local port found near ${start}`);
}

/** Poll an HTTP endpoint until it answers or the timeout expires. */
export async function waitForHttp(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1_500);
      const response = await fetch(url, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (response.status < 500) return true;
    } catch {
      // The tunnel or remote service may still be starting.
    }
    await delay(350);
  }
  return false;
}

/** Wait for a fixed duration. */
export function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
