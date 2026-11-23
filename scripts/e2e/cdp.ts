/** Minimal Chrome DevTools Protocol client used by the real-browser E2E test. */

/** One pending CDP command. */
interface PendingCommand {
  resolve: (value: Record<string, unknown>) => void;
  reject: (reason: Error) => void;
}

/** A CDP event callback. */
export type CdpEventHandler = (params: Record<string, unknown>) => void | Promise<void>;

/** A decoded screencast frame. */
export interface ScreencastFrame {
  data: string;
  timestamp: number;
  sessionId: number;
}

/** A connected Chrome DevTools Protocol session. */
export class CdpClient {
  #socket: WebSocket;
  #nextId = 1;
  #pending = new Map<number, PendingCommand>();
  #handlers = new Map<string, Set<CdpEventHandler>>();

  private constructor(socket: WebSocket) {
    this.#socket = socket;
  }

  /** Connect to a Chrome target debugger URL. */
  static async connect(url: string): Promise<CdpClient> {
    const socket = new WebSocket(url);
    const client = new CdpClient(socket);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error(`Cannot connect to ${url}`)), {
        once: true,
      });
    });
    socket.addEventListener("message", (event) => client.#handleMessage(event.data));
    socket.addEventListener("close", () => {
      for (const command of client.#pending.values()) {
        command.reject(new Error("Chrome DevTools connection closed"));
      }
      client.#pending.clear();
    });
    return client;
  }

  /** Send a CDP command and return its result object. */
  send(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    if (this.#socket.readyState !== WebSocket.OPEN) {
      throw new Error(`Chrome DevTools socket is not open (${method})`);
    }
    const id = this.#nextId++;
    const response = new Promise<Record<string, unknown>>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
    });
    this.#socket.send(JSON.stringify({ id, method, params }));
    return response;
  }

  /** Subscribe to a CDP event. */
  on(event: string, handler: CdpEventHandler): () => void {
    const handlers = this.#handlers.get(event) ?? new Set<CdpEventHandler>();
    handlers.add(handler);
    this.#handlers.set(event, handlers);
    return () => handlers.delete(handler);
  }

  /** Close the DevTools connection. */
  close(): void {
    this.#socket.close();
  }

  #handleMessage(raw: string | ArrayBuffer | Uint8Array): void {
    const text = typeof raw === "string"
      ? raw
      : new TextDecoder().decode(raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw);
    const message = JSON.parse(text) as {
      id?: number;
      method?: string;
      params?: Record<string, unknown>;
      result?: Record<string, unknown>;
      error?: { message?: string };
    };
    if (message.id !== undefined) {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message ?? `CDP command ${message.id} failed`));
      } else {
        pending.resolve(message.result ?? {});
      }
      return;
    }
    if (!message.method) return;
    for (const handler of this.#handlers.get(message.method) ?? []) {
      void handler(message.params ?? {});
    }
  }
}

/** Find the active page target exposed by a Chrome debugging endpoint. */
export async function findPageTarget(port: number): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json() as Record<string, unknown>[];
      const page = targets.find((target) => target.type === "page");
      if (page) return page;
    } catch {
      // Chrome is still starting its debugging endpoint.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Chrome did not expose a page target on port ${port}`);
}
