import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, launchBrowser } from "./e2e/browser.ts";
import { collectBrowserDiagnostics } from "./e2e/diagnostics.ts";
import { E2ePage } from "./e2e/page.ts";
import { startPreviewServer, waitForServer } from "./e2e/preview.ts";
import { decodeBase64, pause } from "./e2e/runtime.ts";
import { verifyNavigationScenario } from "./e2e/scenarios/navigation.ts";
import { verifySettingsScenario } from "./e2e/scenarios/settings.ts";
import { verifyShortcutScenario } from "./e2e/scenarios/shortcuts.ts";
import { verifyUpdateScenario } from "./e2e/scenarios/updates.ts";
import { ScreencastRecorder } from "./e2e/video.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const previewPort = await freePort();
const screenshotPath = join(root, "docs/screenshots/control-center.png");
const videoPath = Deno.env.get("DSH_E2E_VIDEO") ??
  join(root, "docs/videos/dsh-intel-control-center.mp4");
const server = startPreviewServer(root, previewPort);
const recorder = new ScreencastRecorder();
let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;

try {
  await waitForServer(`http://127.0.0.1:${previewPort}/health`);
  browser = await launchBrowser();
  const client = browser.client;
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Network.enable");
  await client.send("Log.enable");
  const diagnostics = collectBrowserDiagnostics(client);
  const page = new E2ePage(client);

  await client.send("Page.navigate", {
    url: `http://127.0.0.1:${previewPort}/control/`,
  });
  await page.waitFor("document.readyState === 'complete'", "页面加载完成");
  await page.waitFor(
    "document.querySelector('#harness-version')?.textContent !== '—'",
    "状态渲染完成",
  );
  await page.installCaption();
  await recorder.start(client);

  const screenshot = await client.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  await Deno.mkdir(dirname(screenshotPath), { recursive: true });
  await Deno.writeFile(screenshotPath, decodeBase64(String(screenshot.data ?? "")));
  await page.setCaption("01 · 概览：桌面壳连接常驻 DSH 服务");
  await pause(1_100);

  await verifyNavigationScenario(page);
  await verifyShortcutScenario(page);
  await verifyUpdateScenario(page);
  await verifySettingsScenario(page);

  await recorder.stop(client);
  if (diagnostics.errors.length > 0) {
    throw new Error(`Browser errors detected:\n${diagnostics.errors.join("\n")}`);
  }
  await recorder.write(videoPath);

  console.log(
    JSON.stringify(
      {
        ok: true,
        screenshot: screenshotPath,
        video: videoPath,
        frames: recorder.frameCount,
        navigationSteps: 5,
        scenarios: 4,
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await server.status;
}
