import type { E2ePage } from "./page.ts";

/** Assert that the visual state and scroll destination match a navigation step. */
export async function assertNavigationState(page: E2ePage, sectionId: string): Promise<void> {
  const state = await page.evaluate<{
    activeHref: string;
    ariaCurrent: string;
    sectionTop: number;
  }>(
    `(() => {
      const link = document.querySelector('.side-nav a[href="#${sectionId}"]');
      const section = document.getElementById('${sectionId}');
      return {
        activeHref: link?.classList.contains('active') ? link.getAttribute('href') : '',
        ariaCurrent: link?.getAttribute('aria-current') ?? '',
        sectionTop: section?.getBoundingClientRect().top ?? Number.NaN,
      };
    })()`,
  );
  if (state.activeHref !== `#${sectionId}`) {
    throw new Error(`Expected #${sectionId} to be active, received ${state.activeHref}`);
  }
  if (state.ariaCurrent !== "location") {
    throw new Error(`Expected aria-current=location for #${sectionId}`);
  }
  if (!Number.isFinite(state.sectionTop) || Math.abs(state.sectionTop) >= 80) {
    throw new Error(
      `Expected #${sectionId} to be at the reading marker, received ${state.sectionTop}`,
    );
  }
}

/** Assert that a shortcut card with the exact label exists. */
export async function assertShortcutExists(page: E2ePage, label: string): Promise<void> {
  const exists = await page.evaluate<boolean>(
    `[...document.querySelectorAll('.shortcut-card strong')].some((node) => node.textContent === ${
      JSON.stringify(label)
    })`,
  );
  if (!exists) throw new Error(`Expected shortcut ${label} to exist`);
}

/** Remove a shortcut card by its visible label. */
export async function removeShortcut(page: E2ePage, label: string): Promise<void> {
  const removed = await page.evaluate<boolean>(
    `(() => {
      const card = [...document.querySelectorAll('.shortcut-card')].find((node) =>
        node.querySelector('strong')?.textContent === ${JSON.stringify(label)}
      );
      const remove = card?.querySelector('.shortcut-remove');
      if (!remove) return false;
      remove.click();
      return true;
    })()`,
  );
  if (!removed) throw new Error(`Could not remove shortcut ${label}`);
}

/** Assert that the toast contains the expected completion message. */
export async function assertToast(page: E2ePage, text: string): Promise<void> {
  const message = await page.evaluate<string>(
    `document.getElementById('toast')?.textContent ?? ''`,
  );
  if (!message.includes(text)) {
    throw new Error(`Expected toast to contain ${text}, received ${message}`);
  }
}
