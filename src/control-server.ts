import type { ControlHost } from "./control-host.ts";
import { Logger } from "./logger.ts";
import { normalizeConfig } from "./config.ts";
import { UI_ASSETS } from "./ui_content.ts";

const CONTROL_HEADER = "x-dsh-intel-control";

/** A loopback-only HTTP server for the native control-center interface. */
export class ControlServer {
  readonly #host: ControlHost;
  readonly #logger: Logger;
  #server: Deno.HttpServer | null = null;
  #origin = "";

  constructor(host: ControlHost, logger: Logger) {
    this.#host = host;
    this.#logger = logger;
  }

  /** Start the server on an ephemeral loopback port. */
  start(port = 0): Promise<string> {
    this.#server = Deno.serve(
      {
        hostname: "127.0.0.1",
        port,
        onListen: ({ hostname, port }) => {
          this.#origin = `http://${hostname}:${port}`;
        },
      },
      (request) => this.#handle(request),
    );
    this.#logger.info(`Control center is available at ${this.#origin}`);
    return Promise.resolve(this.#origin);
  }

  /** Stop the loopback server. */
  async stop(): Promise<void> {
    const server = this.#server;
    this.#server = null;
    if (server !== null) await server.shutdown();
  }

  async #handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "GET") {
        if (url.pathname === "/api/state") return json(await this.#host.getState());
        if (url.pathname === "/api/logs") return json(await this.#host.logs());
        if (url.pathname === "/health") return json({ ok: true });
        return await this.#static(url.pathname);
      }

      if (request.method === "POST") {
        if (!this.#isTrustedControlRequest(request)) {
          return json({ ok: false, error: "Invalid control request origin." }, 403);
        }
        if (url.pathname === "/api/config") {
          const body = await readJson(request);
          const saved = await this.#host.saveConfig(normalizeConfig(body));
          return json({ ok: true, config: saved });
        }
        if (url.pathname === "/api/connect") {
          return json(await this.#host.connect());
        }
        if (url.pathname === "/api/open/harness") {
          return json(await this.#host.openHarness());
        }
        if (url.pathname === "/api/local-service/start") {
          return json(await this.#host.startLocalService());
        }
        if (url.pathname === "/api/local-service/stop") {
          return json(await this.#host.stopLocalService());
        }
        if (url.pathname === "/api/open/control") {
          return json(await this.#host.showControlCenter());
        }
        if (url.pathname === "/api/shortcut/activate") {
          const body = await readJson(request);
          const shortcutId = typeof body === "object" && body !== null && "id" in body
            ? String((body as { id: unknown }).id)
            : "";
          return json(await this.#host.activateShortcut(shortcutId));
        }
        if (url.pathname === "/api/check-updates") {
          return json(await this.#host.checkUpdates());
        }
        if (url.pathname === "/api/update/plugin") {
          return json(await this.#host.update("plugin"));
        }
        if (url.pathname === "/api/update/harness") {
          return json(await this.#host.update("harness"));
        }
        if (url.pathname === "/api/update/all") {
          return json(await this.#host.update("all"));
        }
      }

      return json({ ok: false, error: "Not found." }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#logger.error(`Control request failed: ${message}`, error);
      return json({ ok: false, error: message }, 500);
    }
  }

  #isTrustedControlRequest(request: Request): boolean {
    if (request.headers.get(CONTROL_HEADER) !== "1") return false;
    const origin = request.headers.get("origin");
    if (origin !== null && origin !== this.#origin) return false;
    const host = request.headers.get("host") ?? "";
    return /^127\.0\.0\.1:\d+$/.test(host) || /^localhost:\d+$/.test(host);
  }

  #static(pathname: string): Response {
    const asset = UI_ASSETS[pathname];
    if (asset === undefined) return json({ ok: false, error: "Not found." }, 404);
    return new Response(asset.content, {
      headers: {
        "content-type": asset.type,
        "cache-control": "no-store",
        "content-security-policy":
          "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
      },
    });
  }
}

async function readJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLocaleLowerCase().startsWith("application/json")) {
    throw new Error("Expected an application/json request body.");
  }
  return await request.json();
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
