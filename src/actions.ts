import type { Shortcut } from "./types.ts";

/** Result of trying to activate a shortcut in the official web interface. */
export interface ShortcutResult {
  success: boolean;
  message: string;
}

/**
 * Activate a shortcut in the DSH web application.
 *
 * The official web interface does not expose a stable public URL scheme for
 * every panel. Text and semantic selectors therefore complement the small
 * number of routes that are stable, and the operation reports a clear miss
 * instead of silently navigating somewhere unrelated.
 */
export async function activateShortcut(
  window: Deno.BrowserWindow,
  shortcut: Shortcut,
): Promise<ShortcutResult> {
  if (shortcut.kind === "url") {
    window.navigate(shortcut.url);
    return { success: true, message: `Opened ${shortcut.url}` };
  }

  const script = buildActivationScript(shortcut);
  try {
    const value = await window.executeJs(script);
    if (value === true) {
      return { success: true, message: `Opened ${shortcut.label}` };
    }
    return {
      success: false,
      message: `Could not find “${shortcut.label}” in the current DSH interface.`,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Build a self-contained script that finds and clicks a visible interface item. */
export function buildActivationScript(shortcut: Shortcut): string {
  const target = JSON.stringify(shortcut.target);
  const labels = JSON.stringify(shortcut.matchText);
  const kind = JSON.stringify(shortcut.kind);
  return `(async () => {
    const target = ${target};
    const labels = ${labels};
    const kind = ${kind};
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const textOf = (element) => [
      element.getAttribute('aria-label') || '',
      element.getAttribute('title') || '',
      element.textContent || '',
    ].join(' ').trim();
    const click = (element) => {
      if (!element || !visible(element)) return false;
      element.click();
      return true;
    };
    const findByText = (candidates, wanted) => {
      for (const label of wanted) {
        const normalized = label.toLocaleLowerCase();
        const match = candidates.find((element) => visible(element) && textOf(element).toLocaleLowerCase().includes(normalized));
        if (match) return match;
      }
      return null;
    };
    const findByLabels = (candidates) => findByText(candidates, labels);
    const interactive = () => Array.from(document.querySelectorAll('button, a, [role="button"], [role="tab"], [role="menuitem"], nav item, [data-slot="sidebar.panellist"] *'));
    const semantic = Array.from(document.querySelectorAll(
      '[data-panel-id], [data-testid], [data-slot], [id], [aria-label], [title]'
    ));
    const openPlugins = async () => {
      const exact = semantic.find((element) => visible(element) &&
        (element.getAttribute('data-panel-id') || '').toLocaleLowerCase() === 'plugins');
      const plugins = exact || findByText(interactive(), ['Plugins', '插件']);
      if (plugins) plugins.click();
      await new Promise((resolve) => setTimeout(resolve, 400));
    };
    if (kind === 'text' && target === '@ebony-vinyl/dsh-our-free-model') {
      await openPlugins();
      const packageItem = findByText(
        Array.from(document.querySelectorAll('button, a, [role="button"], [role="tab"]')),
        ['Our Free Model', '我们的免费模型', '免费模型'],
      );
      return packageItem ? click(packageItem) : false;
    }
    if (kind === 'text' && target === 'plugin-update') {
      await openPlugins();
      const packageItem = findByText(
        Array.from(document.querySelectorAll('button, a, [role="button"], [role="tab"]')),
        ['Our Free Model', '我们的免费模型', '免费模型'],
      );
      if (packageItem) {
        packageItem.click();
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      const updateButton = findByText(
        Array.from(document.querySelectorAll('button, a, [role="button"], [role="menuitem"]')),
        ['检查更新', '立即升级', '插件升级', 'Check for updates', 'Update now'],
      );
      return updateButton ? click(updateButton) : false;
    }
    let match = semantic.find((element) =>
      visible(element) && [
        element.getAttribute('data-panel-id') || '',
        element.getAttribute('data-testid') || '',
        element.getAttribute('id') || '',
      ].some((value) => value.toLocaleLowerCase() === target.toLocaleLowerCase())
    );
    if (!match) match = findByLabels(interactive());
    if (!match) match = findByLabels(semantic);
    if (!match) return false;
    return click(match);
  })()`;
}
