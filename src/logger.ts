/** A log entry retained in memory and optionally mirrored to disk. */
export interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
  detail: string;
}

/** Small bounded logger used by the desktop process and control-center API. */
export class Logger {
  readonly #entries: LogEntry[] = [];
  readonly #limit: number;
  readonly #logFile: string | null;

  constructor(limit = 500, logFile: string | null = null) {
    this.#limit = limit;
    this.#logFile = logFile;
  }

  /** Return a copy of retained log entries, newest last. */
  entries(): LogEntry[] {
    return this.#entries.map((entry) => ({ ...entry }));
  }

  /** Record an informational event. */
  info(message: string, detail?: unknown): void {
    this.#write("info", message, detail);
  }

  /** Record a recoverable problem. */
  warn(message: string, detail?: unknown): void {
    this.#write("warn", message, detail);
  }

  /** Record a terminal or security-relevant failure. */
  error(message: string, detail?: unknown): void {
    this.#write("error", message, detail);
  }

  #write(level: LogEntry["level"], message: string, detail?: unknown): void {
    const normalized = normalizeDetail(detail);
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      detail: normalized,
    };
    this.#entries.push(entry);
    if (this.#entries.length > this.#limit) {
      this.#entries.splice(0, this.#entries.length - this.#limit);
    }
    const line = `[${entry.timestamp}] ${level.toUpperCase()} ${message}${
      normalized ? ` ${normalized}` : ""
    }`;
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
    if (this.#logFile !== null) this.#appendToFile(line);
  }

  #appendToFile(line: string): void {
    try {
      Deno.writeTextFileSync(this.#logFile!, `${line}\n`, { append: true });
    } catch {
      // Logging must never take down the desktop process.
    }
  }
}

/** Convert an unknown error into a concise, single-line diagnostic. */
export function normalizeDetail(detail: unknown): string {
  if (detail === undefined || detail === null) return "";
  if (detail instanceof Error) return detail.stack ?? detail.message;
  if (typeof detail === "string") return detail;
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}
