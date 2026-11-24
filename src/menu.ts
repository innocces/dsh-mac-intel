import type { AppConfig, Shortcut } from "./types.ts";

/** Menu identifiers handled by the application controller. */
export const MENU_IDS = {
  openHarness: "app.open-harness",
  openControlCenter: "app.open-control-center",
  checkUpdates: "app.check-updates",
  reload: "app.reload",
  devtools: "app.devtools",
  about: "app.about",
  quit: "app.quit",
  shortcutPrefix: "shortcut:",
} as const;

/** Build the native macOS application menu from the current configuration. */
export function buildApplicationMenu(config: AppConfig): Deno.MenuItem[] {
  const groups = new Map<string, Shortcut[]>();
  for (const shortcut of config.shortcuts) {
    const group = shortcut.group.trim() || "快捷方式";
    const entries = groups.get(group) ?? [];
    entries.push(shortcut);
    groups.set(group, entries);
  }

  const shortcutSubmenu: Deno.MenuItem[] = [];
  for (const [group, shortcuts] of groups) {
    shortcutSubmenu.push({
      submenu: {
        label: group,
        items: shortcuts.map((shortcut) => ({
          item: {
            label: shortcut.label,
            id: `${MENU_IDS.shortcutPrefix}${shortcut.id}`,
            enabled: true,
          },
        })),
      },
    });
  }
  if (shortcutSubmenu.length === 0) {
    shortcutSubmenu.push({
      item: {
        label: "没有可用快捷方式",
        enabled: false,
      },
    });
  }

  return [
    {
      submenu: {
        label: "DSH Intel",
        items: [
          {
            item: {
              label: "关于 DSH Intel",
              id: MENU_IDS.about,
              enabled: true,
            },
          },
          { role: { role: "hide" } },
          { role: { role: "hideOthers" } },
          { role: { role: "unhide" } },
          "separator",
          {
            item: {
              label: "退出 DSH Intel",
              id: MENU_IDS.quit,
              accelerator: "Cmd+Q",
              enabled: true,
            },
          },
        ],
      },
    },
    {
      submenu: {
        label: "文件",
        items: [
          {
            item: {
              label: "在当前窗口打开 DeepSeek Harness",
              id: MENU_IDS.openHarness,
              accelerator: "Cmd+O",
              enabled: true,
            },
          },
          {
            item: {
              label: "显示控制中心",
              id: MENU_IDS.openControlCenter,
              accelerator: "Cmd+Shift+C",
              enabled: true,
            },
          },
        ],
      },
    },
    {
      submenu: {
        label: "编辑",
        items: [
          { role: { role: "undo" } },
          { role: { role: "redo" } },
          "separator",
          { role: { role: "cut" } },
          { role: { role: "copy" } },
          { role: { role: "paste" } },
          { role: { role: "selectAll" } },
        ],
      },
    },
    {
      submenu: {
        label: "视图",
        items: [
          {
            item: {
              label: "重新加载",
              id: MENU_IDS.reload,
              accelerator: "Cmd+R",
              enabled: true,
            },
          },
          {
            item: {
              label: "开发者工具",
              id: MENU_IDS.devtools,
              accelerator: "Cmd+Alt+I",
              enabled: true,
            },
          },
        ],
      },
    },
    {
      submenu: {
        label: "快捷方式",
        items: shortcutSubmenu,
      },
    },
    {
      submenu: {
        label: "更新",
        items: [
          {
            item: {
              label: "检查全部更新",
              id: MENU_IDS.checkUpdates,
              accelerator: "Cmd+U",
              enabled: true,
            },
          },
        ],
      },
    },
    {
      submenu: {
        label: "窗口",
        items: [
          { role: { role: "minimize" } },
          { role: { role: "zoom" } },
          { role: { role: "front" } },
        ],
      },
    },
  ];
}
