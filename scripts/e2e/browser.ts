import { CdpClient, findPageTarget } from "./cdp.ts";

/** A running Chrome instance and its DevTools connection. */
export interface BrowserSession {
  client: CdpClient;
  close: () => Promise<void>;
}

/** Locate a locally installed Chrome or Chromium browser. */
async function findChrome(): Promise<string> {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  for (const candidate of candidates) {
    try {
      const info = await Deno.stat(candidate);
      if (info.isFile) return candidate;
    } catch {
      // Try the next browser candidate.
    }
  }
  throw new Error("Chrome or Chromium is required for the E2E test.");
}

/** Reserve an unused local TCP port. */
export function freePort(): number {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const address = listener.addr as Deno.NetAddr;
  listener.close();
  return address.port;
}

/** Launch headless Chrome and connect to its first page target. */
export async function launchBrowser(): Promise<BrowserSession> {
  const chrome = await findChrome();
  const port = await freePort();
  const profileDirectory = await Deno.makeTempDir({ prefix: "dsh-intel-e2e-" });
  const chromeProcess = new Deno.Command(chrome, {
    args: [
      "--headless=new",
      "--disable-gpu",
      "--disable-extensions",
      "--disable-background-networking",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-allow-origins=*",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDirectory}`,
      "--window-size=1440,1000",
      "--force-device-scale-factor=1",
      "about:blank",
    ],
    stdout: "null",
    stderr: "null",
  }).spawn();

  try {
    const target = await findPageTarget(port);
    const debuggerUrl = String(target.webSocketDebuggerUrl ?? "");
    if (!debuggerUrl) throw new Error("Chrome page target did not expose a debugger URL.");
    const client = await CdpClient.connect(debuggerUrl);
    return {
      client,
      close: async () => {
        client.close();
        chromeProcess.kill("SIGTERM");
        await chromeProcess.status;
        await Deno.remove(profileDirectory, { recursive: true });
      },
    };
  } catch (error) {
    chromeProcess.kill("SIGTERM");
    await chromeProcess.status;
    await Deno.remove(profileDirectory, { recursive: true });
    throw error;
  }
}
