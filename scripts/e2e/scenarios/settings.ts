import { assertManagedUpdatesEnabled, assertNoErrorNotice, assertToast } from "../assertions.ts";
import type { E2ePage } from "../page.ts";
import { pause } from "../runtime.ts";

/** Verify saving connection settings and automatic-update preferences. */
export async function verifySettingsScenario(page: E2ePage): Promise<void> {
  await page.click(".side-nav a[href='#settings']");
  await page.setCaption("08 · 保存设置：自动更新策略即时生效");
  await page.setInput("#profile-name", "DSH Intel E2E");
  await page.setChecked("#auto-check", true);
  await page.click("#save-settings-button");
  await page.waitFor(
    "document.getElementById('toast').hidden === false && document.getElementById('toast').textContent.includes('已保存')",
    "连接设置已保存",
  );
  await assertToast(page, "已保存");
  await page.click("#connect-button");
  await page.waitFor(
    "document.getElementById('toast').textContent.includes('SSH 服务器和用户')",
    "缺少 SSH 配置时显示操作指引",
  );
  await assertNoErrorNotice(page);
  await page.setInput("#ssh-host", "dsh.example.com");
  await page.setInput("#ssh-user", "dsh");
  await page.click("#save-settings-button");
  await page.waitFor(
    "document.getElementById('toast').textContent.includes('已保存')",
    "SSH 配置已保存",
  );
  await assertManagedUpdatesEnabled(page);
  await pause(1_200);
}
