import type { CdpClient } from "./cdp.ts";

/** Browser-level errors observed during the E2E run. */
export interface BrowserDiagnostics {
  errors: string[];
}

/** Collect console, log, and network errors from a Chrome page. */
export function collectBrowserDiagnostics(client: CdpClient): BrowserDiagnostics {
  const diagnostics: BrowserDiagnostics = { errors: [] };
  client.on("Runtime.consoleAPICalled", (params) => {
    if (params.type !== "error") return;
    const args = Array.isArray(params.args) ? params.args : [];
    const message = args.map((arg) =>
      typeof arg === "object" && arg !== null && "value" in arg ? String(arg.value) : ""
    ).join(" ");
    diagnostics.errors.push(`console: ${message}`);
  });
  client.on("Log.entryAdded", (params) => {
    const entry = params.entry as Record<string, unknown> | undefined;
    if (entry?.level === "error") diagnostics.errors.push(`log: ${String(entry.text)}`);
  });
  client.on("Network.loadingFailed", (params) => {
    const error = String(params.errorText ?? "network failure");
    if (!error.includes("ERR_ABORTED")) diagnostics.errors.push(`network: ${error}`);
  });
  return diagnostics;
}
