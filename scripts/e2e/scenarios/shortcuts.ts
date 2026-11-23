import { assertShortcutExists, removeShortcut } from "../assertions.ts";
import type { E2ePage } from "../page.ts";
import { pause } from "../runtime.ts";

/** Verify adding and removing a custom shortcut through the real dialog. */
export async function verifyShortcutScenario(page: E2ePage): Promise<void> {
  await page.click(".side-nav a[href='#shortcuts']");
  await pause(500);
  await page.setCaption("06 · 自定义快捷方式：新增、激活并移除");
  await page.click("#add-shortcut-button");
  await page.waitFor("document.getElementById('shortcut-dialog').open", "快捷方式对话框打开");
  await page.setInput("#shortcut-label", "E2E 插件入口");
  await page.setInput("#shortcut-target", "plugins");
  await page.setInput("#shortcut-match", "插件, Plugins");
  await page.click("#save-shortcut-button");
  await page.waitFor(
    "[...document.querySelectorAll('.shortcut-card strong')].some((node) => node.textContent === 'E2E 插件入口')",
    "自定义快捷方式已添加",
  );
  await assertShortcutExists(page, "E2E 插件入口");
  await pause(900);
  await removeShortcut(page, "E2E 插件入口");
  await page.waitFor(
    "![...document.querySelectorAll('.shortcut-card strong')].some((node) => node.textContent === 'E2E 插件入口')",
    "自定义快捷方式已移除",
  );
  await pause(700);
}
