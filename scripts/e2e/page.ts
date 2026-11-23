import type { CdpClient } from "./cdp.ts";
import { pause } from "./runtime.ts";

/** Typed browser-page operations used by the E2E scenarios. */
export class E2ePage {
  constructor(readonly client: CdpClient) {}

  /** Evaluate JavaScript in the page and return a serializable value. */
  async evaluate<T>(expression: string): Promise<T> {
    const response = await this.client.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    const result = response.result as Record<string, unknown> | undefined;
    const exception = response.exceptionDetails as Record<string, unknown> | undefined;
    if (exception) throw new Error(String(exception.text ?? "Browser evaluation failed"));
    return result?.value as T;
  }

  /** Poll a browser expression until it becomes truthy. */
  async waitFor(expression: string, label: string): Promise<void> {
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      if (await this.evaluate<boolean>(`Boolean(${expression})`)) return;
      await pause(100);
    }
    throw new Error(`Timed out waiting for ${label}`);
  }

  /** Click an element through the live DOM. */
  async click(selector: string): Promise<void> {
    const clicked = await this.evaluate<boolean>(
      `(() => { const node = document.querySelector(${
        JSON.stringify(selector)
      }); if (!node) return false; node.click(); return true; })()`,
    );
    if (!clicked) throw new Error(`Could not click ${selector}`);
  }

  /** Set a text input and dispatch the events used by the application. */
  async setInput(selector: string, value: string): Promise<void> {
    const changed = await this.evaluate<boolean>(
      `(() => { const node = document.querySelector(${
        JSON.stringify(selector)
      }); if (!node) return false; node.value = ${
        JSON.stringify(value)
      }; node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`,
    );
    if (!changed) throw new Error(`Could not set ${selector}`);
  }

  /** Set a checkbox and dispatch its change event. */
  async setChecked(selector: string, checked: boolean): Promise<void> {
    const changed = await this.evaluate<boolean>(
      `(() => { const node = document.querySelector(${
        JSON.stringify(selector)
      }); if (!node) return false; node.checked = ${checked}; node.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`,
    );
    if (!changed) throw new Error(`Could not toggle ${selector}`);
  }

  /** Install a temporary caption layer used only by the recorded walkthrough. */
  async installCaption(): Promise<void> {
    await this.evaluate(
      `(() => {
        const caption = document.createElement('div');
        caption.id = 'e2e-caption';
        caption.textContent = 'DSH Intel · 完整使用流程';
        Object.assign(caption.style, {
          position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)',
          zIndex: '9999', padding: '10px 18px', borderRadius: '999px',
          background: 'rgba(18, 31, 78, 0.92)', color: '#fff', fontSize: '14px',
          fontWeight: '600', boxShadow: '0 12px 30px rgba(0,0,0,.24)',
          pointerEvents: 'none', transition: 'opacity 180ms ease'
        });
        document.body.append(caption);
        return true;
      })()`,
    );
  }

  /** Update the temporary walkthrough caption. */
  async setCaption(text: string): Promise<void> {
    await this.evaluate(
      `(() => { const node = document.getElementById('e2e-caption'); if (node) node.textContent = ${
        JSON.stringify(text)
      }; return true; })()`,
    );
  }
}
