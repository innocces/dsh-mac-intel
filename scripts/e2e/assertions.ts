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

/** Assert that the SVG icon embeds its artwork instead of relying on an external image. */
export async function assertEmbeddedIconArtwork(page: E2ePage): Promise<void> {
  const embedded = await page.evaluate<boolean>(
    `fetch('/assets/DSH-Intel-icon.svg').then((response) => response.text()).then((svg) => svg.includes('data:image/png;base64,'))`,
  );
  if (!embedded) throw new Error("The control-center SVG icon does not embed its artwork.");
}

/** Assert that managed updates remain disabled until an SSH profile is configured. */
export async function assertManagedUpdatesRequireSsh(page: E2ePage): Promise<void> {
  const state = await page.evaluate<{ disabled: boolean; requirement: string }>(
    `(() => ({
      disabled: [...document.querySelectorAll('[data-update]')].every((button) => button.disabled),
      requirement: document.getElementById('update-requirement')?.textContent ?? '',
    }))()`,
  );
  if (!state.disabled) throw new Error("Managed update buttons should be disabled without SSH.");
  if (!state.requirement.includes("dsh-mac-intel-service")) {
    throw new Error("The managed-update requirement is missing.");
  }
}

/** Assert that the official DSH and OpenSSH defaults are present in the form. */
export async function assertOfficialConnectionDefaults(page: E2ePage): Promise<void> {
  const values = await page.evaluate<Record<string, string>>(`(() => {
    const value = (id) => document.getElementById(id).value;
    return {
      transport: value('transport-select'),
      webUrl: value('web-url'),
      sshPort: value('ssh-port'),
      remotePort: value('remote-port'),
      localPort: value('local-port'),
      servicePath: value('service-path'),
    };
  })()`);
  const expected = {
    transport: "ssh",
    webUrl: "http://127.0.0.1:3080",
    sshPort: "22",
    remotePort: "3080",
    localPort: "3080",
    servicePath: "~/.local/share/dsh-mac-intel/bin/dsh-mac-intel-service",
  };
  for (const [key, value] of Object.entries(expected)) {
    if (values[key] !== value) {
      throw new Error(`Official default ${key} should be ${value}, got ${values[key]}.`);
    }
  }
}

/** Assert that managed updates become available after saving a valid SSH profile. */
export async function assertManagedUpdatesEnabled(page: E2ePage): Promise<void> {
  const enabled = await page.evaluate<boolean>(
    `[...document.querySelectorAll('[data-update]')].every((button) => !button.disabled)`,
  );
  if (!enabled) {
    throw new Error("Managed update buttons should be enabled for a saved SSH profile.");
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

/** Assert that the global error notice remains hidden. */
export async function assertNoErrorNotice(page: E2ePage): Promise<void> {
  const visible = await page.evaluate<boolean>(
    `document.getElementById('error-notice')?.hidden === false`,
  );
  if (visible) throw new Error("The control center displayed an unexpected error notice.");
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
