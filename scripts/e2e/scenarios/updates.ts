import { assertManagedUpdatesRequireSsh, assertToast } from "../assertions.ts";
import type { E2ePage } from "../page.ts";
import { pause } from "../runtime.ts";

/** Verify the update-center action and its user-visible completion state. */
export async function verifyUpdateScenario(page: E2ePage): Promise<void> {
  await assertManagedUpdatesRequireSsh(page);
  await page.click(".side-nav a[href='#updates']");
  await page.setCaption("07 · 检查更新：读取当前与最新版本");
  await page.click("#check-updates-button");
  await page.waitFor(
    "document.getElementById('toast').hidden === false && document.getElementById('toast').textContent.includes('内置版本')",
    "更新检查完成",
  );
  await assertToast(page, "内置版本");
  await pause(1_000);
}
