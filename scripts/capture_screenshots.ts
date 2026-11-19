import { join } from "node:path";

/** Capture the actual local control center with headless Chrome. */
async function main(): Promise<void> {
  const root = new URL("../", import.meta.url).pathname;
  const chromeCandidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];
  let chrome = "";
  for (const candidate of chromeCandidates) {
    try {
      const info = await Deno.stat(candidate);
      if (info.isFile) {
        chrome = candidate;
        break;
      }
    } catch {
      // Try the next browser candidate.
    }
  }
  if (!chrome) {
    throw new Error("Chrome or Chromium is required to capture the control-center screenshot.");
  }

  const port = 4173;
  const server = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-env",
      "--allow-net=127.0.0.1",
      "--allow-read",
      "--allow-write",
      join(root, "scripts/preview_server.ts"),
      `--port=${port}`,
    ],
    cwd: root,
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  try {
    await waitForServer(`http://127.0.0.1:${port}/health`);
    const outputDirectory = join(root, "docs/screenshots");
    await Deno.mkdir(outputDirectory, { recursive: true });
    const screenshotPath = join(outputDirectory, "control-center.png");
    const profileDirectory = await Deno.makeTempDir({ prefix: "dsh-intel-chrome-" });
    const output = await new Deno.Command(chrome, {
      args: [
        "--headless=new",
        "--disable-gpu",
        "--disable-extensions",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        "--run-all-compositor-stages-before-draw",
        "--virtual-time-budget=1800",
        `--user-data-dir=${profileDirectory}`,
        "--window-size=1440,1000",
        `--screenshot=${screenshotPath}`,
        `http://127.0.0.1:${port}/control/`,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    await Deno.remove(profileDirectory, { recursive: true });
    if (!output.success) {
      throw new Error(
        new TextDecoder().decode(output.stderr) || "Chrome screenshot capture failed.",
      );
    }
    const info = await Deno.stat(screenshotPath);
    if (info.size === 0) throw new Error("Chrome produced an empty screenshot.");
    console.log(`Captured ${screenshotPath} (${info.size} bytes)`);
  } finally {
    server.kill("SIGTERM");
    await server.status;
  }
}

async function waitForServer(url: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The preview server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Preview server did not start at ${url}`);
}

if (import.meta.main) {
  await main();
}
