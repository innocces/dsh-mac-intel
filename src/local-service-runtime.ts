import { homeDirectory, parseAuthenticatedUrl } from "./local-service-storage.ts";

/** Poll an HTTP endpoint until it becomes healthy. */
export async function waitForHealth(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isHealthy(url)) return true;
    await delay(500);
  }
  return false;
}

/** Wait for DSH to print and accept its one-time authenticated Web URL. */
export async function waitForAuthenticatedUrl(
  logPath: string,
  timeoutMs: number,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = await readAuthenticatedUrl(logPath);
    if (url !== null && await isHealthy(url)) return url;
    await delay(500);
  }
  return null;
}

/** Read the Node.js version from the installed runtime headers. */
export async function readLocalNodeVersion(nodeDirectory: string): Promise<string> {
  try {
    const header = await Deno.readTextFile(
      `${nodeDirectory}/include/node/node_version.h`,
    );
    const major = header.match(/#define NODE_MAJOR_VERSION\s+(\d+)/)?.[1] ?? "";
    const minor = header.match(/#define NODE_MINOR_VERSION\s+(\d+)/)?.[1] ?? "";
    const patch = header.match(/#define NODE_PATCH_VERSION\s+(\d+)/)?.[1] ?? "";
    return major && minor && patch ? `${major}.${minor}.${patch}` : "";
  } catch {
    return "";
  }
}

/** Read a package version from an npm manifest. */
export async function readPackageVersion(manifestPath: string): Promise<string> {
  try {
    const manifest = JSON.parse(await Deno.readTextFile(manifestPath)) as {
      version?: unknown;
    };
    return typeof manifest.version === "string" ? manifest.version : "";
  } catch {
    return "";
  }
}

/** Read a JSON object from disk. */
export async function readJsonFile(path: string): Promise<Record<string, unknown>> {
  try {
    const value = JSON.parse(await Deno.readTextFile(path)) as unknown;
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

/** Test whether a value is a non-array object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Test whether a filesystem entry exists. */
export async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Read text from disk, returning an empty string on failure. */
export async function readTextFile(path: string): Promise<string> {
  try {
    return await Deno.readTextFile(path);
  } catch {
    return "";
  }
}

/** Build a minimal environment for isolated package-management commands. */
export function commandEnvironment(extra: Record<string, string>): Record<string, string> {
  const environment: Record<string, string> = {
    HOME: Deno.env.get("HOME") ?? homeDirectory(),
    PATH: Deno.env.get("PATH") ?? "/usr/local/bin:/usr/bin:/bin",
  };
  for (
    const name of [
      "TMPDIR",
      "LANG",
      "LC_ALL",
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "NO_PROXY",
      "SSL_CERT_FILE",
      "NODE_EXTRA_CA_CERTS",
    ]
  ) {
    try {
      const value = Deno.env.get(name);
      if (value) environment[name] = value;
    } catch {
      // Optional environment variables may not be granted by a packaged app.
    }
  }
  return { ...environment, ...extra };
}

/** Reload a LaunchAgent so launchd applies a newly written plist and environment. */
export async function reloadLaunchAgent(
  domain: string,
  target: string,
  plistPath: string,
  label: string,
): Promise<void> {
  const loaded = await runCommand("/bin/launchctl", ["print", target]);
  if (loaded.success) {
    const stopped = await runCommand("/bin/launchctl", ["bootout", target]);
    if (!stopped.success && !/could not find service|not found|no service/i.test(stopped.stderr)) {
      throw new Error(`${label}重载失败：${stopped.stderr || stopped.stdout}`);
    }
    const unloadDeadline = Date.now() + 5_000;
    while (Date.now() < unloadDeadline) {
      const remaining = await runCommand("/bin/launchctl", ["print", target]);
      if (!remaining.success) break;
      await delay(100);
    }
  }

  let lastError = "";
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const bootstrapped = await runCommand("/bin/launchctl", [
      "bootstrap",
      domain,
      plistPath,
    ]);
    if (bootstrapped.success) {
      const started = await runCommand("/bin/launchctl", ["kickstart", "-k", target]);
      if (!started.success) {
        throw new Error(`${label}启动失败：${started.stderr || started.stdout}`);
      }
      return;
    }
    lastError = bootstrapped.stderr || bootstrapped.stdout;
    await delay(250);
  }
  throw new Error(`${label}注册失败：${lastError}`);
}

/** Run a command without inheriting stdin and capture both output streams. */
export async function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string> } = {},
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  try {
    const output = await new Deno.Command(command, {
      args,
      cwd: options.cwd,
      env: options.env,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    }).output();
    return {
      success: output.success,
      stdout: new TextDecoder().decode(output.stdout).trim(),
      stderr: new TextDecoder().decode(output.stderr).trim(),
    };
  } catch (error) {
    return {
      success: false,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function isHealthy(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1_500);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
    });
    return response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function readAuthenticatedUrl(logPath: string): Promise<string | null> {
  return parseAuthenticatedUrl(await readTextFile(logPath));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
