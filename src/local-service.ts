import type { LocalServiceState } from "./types.ts";
import { Logger } from "./logger.ts";
import { appDataDirectory } from "./config.ts";
import { DSH_BOOTSTRAP_VERSION, OFM_BOOTSTRAP_VERSION } from "./types.ts";
import {
  DSH_WEB_HOST,
  DSH_WEB_PORT,
  LOCAL_NODE_SHA256,
  LOCAL_NODE_URL,
  LOCAL_NODE_VERSION,
  LOCAL_SERVICE_LABEL,
} from "./constants.ts";

/** Filesystem locations used by the optional macOS local service. */
export interface LocalServicePaths {
  base: string;
  nodeDirectory: string;
  harnessDirectory: string;
  pnpmDirectory: string;
  dshHome: string;
  launchAgentPath: string;
  logPath: string;
}

/** Values required to render a macOS LaunchAgent property list. */
export interface LaunchAgentOptions {
  label: string;
  nodePath: string;
  dshPath: string;
  dshHome: string;
  path: string;
  host: string;
  port: number;
  workingDirectory: string;
  logPath: string;
}

/** Install, launch, and inspect an isolated DSH web service on this Mac. */
export class LocalServiceManager {
  readonly #logger: Logger;
  readonly #paths: LocalServicePaths;
  readonly #npmCacheDirectory: string;
  #operation: Promise<LocalServiceState> | null = null;
  #state: LocalServiceState = {
    status: "not-installed",
    installed: false,
    running: false,
    version: "",
    url: `http://${DSH_WEB_HOST}:${DSH_WEB_PORT}`,
    message: "尚未安装本机服务。",
  };

  constructor(logger: Logger) {
    this.#logger = logger;
    this.#paths = resolveLocalServicePaths();
    this.#npmCacheDirectory = `${this.#paths.base}/npm-cache`;
  }

  /** Return the current local-service lifecycle state. */
  async getState(): Promise<LocalServiceState> {
    if (this.#operation !== null) return { ...this.#state };
    const installed = await fileExists(this.#dshPath());
    const running = installed &&
      await isHealthy(`http://${DSH_WEB_HOST}:${DSH_WEB_PORT}`);
    const version = installed ? await readPackageVersion(this.#dshManifestPath()) : "";
    const url = running ? await readAuthenticatedUrl(this.#paths.logPath) : null;
    this.#state = {
      status: running ? "running" : installed ? "stopped" : "not-installed",
      installed,
      running,
      version,
      url: url ?? this.#state.url,
      message: running
        ? `本机 DSH Web 正在运行于 http://${DSH_WEB_HOST}:${DSH_WEB_PORT}。`
        : installed
        ? "本机服务已安装，当前未运行。"
        : "尚未安装本机服务。",
    };
    return { ...this.#state };
  }

  /** Install missing components and start the LaunchAgent. */
  async start(): Promise<LocalServiceState> {
    if (this.#operation !== null) return await this.#operation;
    const operation = this.#start();
    this.#operation = operation;
    try {
      return await operation;
    } finally {
      if (this.#operation === operation) this.#operation = null;
    }
  }

  /** Stop the LaunchAgent without deleting its isolated installation. */
  async stop(): Promise<LocalServiceState> {
    const domain = launchDomain();
    const result = await runCommand("/bin/launchctl", [
      "bootout",
      `${domain}/${LOCAL_SERVICE_LABEL}`,
    ]);
    if (
      !result.success &&
      !/could not find service|not found|no service/i.test(result.stderr)
    ) {
      throw new Error(result.stderr || "无法停止本机 DSH 服务。");
    }
    this.#state = {
      ...this.#state,
      status: "stopped",
      running: false,
      message: "本机 DSH 服务已停止；已安装文件仍保留。",
    };
    this.#logger.info(this.#state.message);
    return { ...this.#state };
  }

  async #start(): Promise<LocalServiceState> {
    this.#state = {
      ...this.#state,
      status: "installing",
      message: "正在准备隔离的 Node.js 与 DSH 运行时…",
    };
    try {
      await Deno.mkdir(this.#paths.base, { recursive: true });
      await Deno.mkdir(this.#paths.dshHome, { recursive: true });
      await this.#ensureNode();
      await this.#ensureNpmPackage(
        this.#paths.harnessDirectory,
        "@deepseek-ai/dsh",
        DSH_BOOTSTRAP_VERSION,
        this.#dshManifestPath(),
      );
      await this.#ensureNpmPackage(
        this.#paths.pnpmDirectory,
        "pnpm",
        "11.28.5",
        `${this.#paths.pnpmDirectory}/node_modules/pnpm/package.json`,
      );
      const pluginInstalled = await this.#ensurePlugin();
      await this.#cleanupPackageCaches();
      await this.#writeLaunchAgent();
      await this.#launchAgent();

      this.#state = {
        ...this.#state,
        status: "starting",
        message: "本机服务已安装，正在等待 DSH Web 就绪…",
      };
      const authenticatedUrl = await waitForAuthenticatedUrl(
        this.#paths.logPath,
        120_000,
      );
      if (authenticatedUrl === null) {
        const details = await readTextFile(this.#paths.logPath).catch(() => "");
        throw new Error(
          `本机 DSH 服务未能在两分钟内就绪。${details ? `\n${details.slice(-2000)}` : ""}`,
        );
      }
      this.#state = {
        status: "running",
        installed: true,
        running: true,
        version: DSH_BOOTSTRAP_VERSION,
        url: authenticatedUrl ?? this.#state.url,
        message: pluginInstalled
          ? `本机 DSH Web 已启动于 http://${DSH_WEB_HOST}:${DSH_WEB_PORT}，默认插件已安装。`
          : `本机 DSH Web 已启动于 http://${DSH_WEB_HOST}:${DSH_WEB_PORT}；默认插件安装失败，但不影响 Web 启动。`,
      };
      this.#logger.info(this.#state.message);
      return { ...this.#state };
    } catch (error) {
      await this.#cleanupPackageCaches();
      const message = error instanceof Error ? error.message : String(error);
      this.#state = {
        ...this.#state,
        status: "error",
        running: false,
        message,
      };
      this.#logger.error(`Local service installation failed: ${message}`, error);
      throw error;
    }
  }

  async #ensureNode(): Promise<void> {
    const nodePath = `${this.#paths.nodeDirectory}/bin/node`;
    if (await fileExists(nodePath)) {
      const version = await readLocalNodeVersion(this.#paths.nodeDirectory);
      if (version === LOCAL_NODE_VERSION) {
        this.#logger.info(`Local Node.js ${LOCAL_NODE_VERSION} is already installed`);
        return;
      }
    }

    this.#logger.info(`Downloading isolated Node.js ${LOCAL_NODE_VERSION} for macOS Intel`);
    const response = await fetch(LOCAL_NODE_URL);
    if (!response.ok) {
      throw new Error(`Node.js 下载失败：HTTP ${response.status}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const checksum = [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
    if (checksum !== LOCAL_NODE_SHA256) {
      throw new Error("Node.js 安装包 SHA-256 校验失败。");
    }

    const archivePath = `${this.#paths.base}/${LOCAL_NODE_URL.split("/").at(-1)}`;
    const temporaryDirectory = `${this.#paths.base}/node.tmp`;
    await Deno.writeFile(archivePath, bytes);
    await Deno.remove(temporaryDirectory, { recursive: true }).catch(() => undefined);
    await Deno.mkdir(temporaryDirectory, { recursive: true });
    const extracted = await runCommand("/usr/bin/tar", [
      "-xzf",
      archivePath,
      "--strip-components=1",
      "-C",
      temporaryDirectory,
    ]);
    await Deno.remove(archivePath).catch(() => undefined);
    if (!extracted.success) {
      throw new Error(`Node.js 解压失败：${extracted.stderr || extracted.stdout}`);
    }
    await Deno.remove(this.#paths.nodeDirectory, { recursive: true }).catch(() => undefined);
    await Deno.rename(temporaryDirectory, this.#paths.nodeDirectory);
  }

  async #ensureNpmPackage(
    prefix: string,
    packageName: string,
    version: string,
    manifestPath: string,
  ): Promise<void> {
    if (await readPackageVersion(manifestPath) === version) {
      this.#logger.info(`${packageName}@${version} is already installed`);
      return;
    }
    await Deno.mkdir(prefix, { recursive: true });
    const npmCli = `${this.#paths.nodeDirectory}/lib/node_modules/npm/bin/npm-cli.js`;
    const result = await runCommand(
      "node",
      [
        npmCli,
        "install",
        "--prefix",
        prefix,
        "--no-audit",
        "--no-fund",
        "--save-exact",
        `${packageName}@${version}`,
      ],
      {
        env: commandEnvironment({
          PATH: this.#servicePath(),
          NPM_CONFIG_REGISTRY: "https://registry.npmjs.org",
          npm_config_cache: this.#npmCacheDirectory,
          npm_config_update_notifier: "false",
        }),
      },
    );
    if (!result.success) {
      throw new Error(
        `${packageName}@${version} 安装失败：${result.stderr || result.stdout}`,
      );
    }
    this.#logger.info(`Installed ${packageName}@${version}`);
  }

  async #ensurePlugin(): Promise<boolean> {
    const profileDirectory = `${this.#paths.dshHome}/profiles/web`;
    const aliasManifestPath = `${profileDirectory}/node_modules/dsh-our-free-model/package.json`;
    if (await readPackageVersion(aliasManifestPath) === OFM_BOOTSTRAP_VERSION) return true;
    await Deno.mkdir(profileDirectory, { recursive: true });
    const result = await runCommand(
      "node",
      [
        this.#dshPath(),
        "plugin",
        "--profile",
        "web",
        "add",
        `@ebony-vinyl/dsh-our-free-model@${OFM_BOOTSTRAP_VERSION}`,
      ],
      {
        cwd: profileDirectory,
        env: commandEnvironment({
          DSH_HOME: this.#paths.dshHome,
          PATH: this.#servicePath(),
          NPM_CONFIG_REGISTRY: "https://registry.npmjs.org",
          npm_config_cache: this.#npmCacheDirectory,
          npm_config_store_dir: `${this.#paths.base}/pnpm-store`,
        }),
      },
    );
    if (!result.success) {
      this.#logger.warn(`Default plugin installation failed: ${result.stderr || result.stdout}`);
      return false;
    }

    const profileManifestPath = `${profileDirectory}/package.json`;
    const profileManifest = await readJsonFile(profileManifestPath);
    const dependencies = isRecord(profileManifest.dependencies)
      ? { ...profileManifest.dependencies }
      : {};
    delete dependencies["@ebony-vinyl/dsh-our-free-model"];
    dependencies["dsh-our-free-model"] =
      `npm:@ebony-vinyl/dsh-our-free-model@${OFM_BOOTSTRAP_VERSION}`;
    const profile = isRecord(profileManifest.dsh) && isRecord(profileManifest.dsh.profile)
      ? profileManifest.dsh.profile
      : {};
    const bundles = Array.isArray(profile.bundles)
      ? profile.bundles.filter((bundle): bundle is string => typeof bundle === "string")
      : [];
    profileManifest.dependencies = dependencies;
    profileManifest.dsh = {
      ...(isRecord(profileManifest.dsh) ? profileManifest.dsh : {}),
      profile: {
        ...profile,
        bundles: [
          ...bundles.filter((bundle) =>
            bundle !== "@ebony-vinyl/dsh-our-free-model" && bundle !== "dsh-our-free-model"
          ),
          "dsh-our-free-model",
        ],
      },
    };
    await Deno.writeTextFile(
      profileManifestPath,
      `${JSON.stringify(profileManifest, null, 2)}\n`,
    );

    const pnpmPath = `${this.#paths.pnpmDirectory}/node_modules/pnpm/bin/pnpm.mjs`;
    const installed = await runCommand(
      "node",
      [pnpmPath, "install", "--no-frozen-lockfile"],
      {
        cwd: profileDirectory,
        env: commandEnvironment({
          DSH_HOME: this.#paths.dshHome,
          PATH: this.#servicePath(),
          NPM_CONFIG_REGISTRY: "https://registry.npmjs.org",
          npm_config_cache: this.#npmCacheDirectory,
          npm_config_store_dir: `${this.#paths.base}/pnpm-store`,
        }),
      },
    );
    if (!installed.success) {
      this.#logger.warn(
        `Default plugin alias installation failed: ${installed.stderr || installed.stdout}`,
      );
      return false;
    }
    return await readPackageVersion(aliasManifestPath) === OFM_BOOTSTRAP_VERSION;
  }

  async #cleanupPackageCaches(): Promise<void> {
    await Deno.remove(this.#npmCacheDirectory, { recursive: true }).catch(() => undefined);
    await Deno.remove(`${this.#paths.base}/pnpm-store`, { recursive: true }).catch(() => undefined);
  }

  async #writeLaunchAgent(): Promise<void> {
    const launchAgents = `${homeDirectory()}/Library/LaunchAgents`;
    await Deno.mkdir(launchAgents, { recursive: true });
    const logFile = await Deno.open(this.#paths.logPath, { create: true, append: true });
    logFile.close();
    await Deno.chmod(this.#paths.logPath, 0o600);
    await Deno.truncate(this.#paths.logPath, 0);
    const plist = buildLaunchAgentPlist({
      label: LOCAL_SERVICE_LABEL,
      nodePath: `${this.#paths.nodeDirectory}/bin/node`,
      dshPath: this.#dshPath(),
      dshHome: this.#paths.dshHome,
      path: this.#servicePath(),
      host: DSH_WEB_HOST,
      port: DSH_WEB_PORT,
      workingDirectory: this.#paths.dshHome,
      logPath: this.#paths.logPath,
    });
    await Deno.writeTextFile(this.#paths.launchAgentPath, plist);
  }

  async #launchAgent(): Promise<void> {
    const domain = launchDomain();
    const target = `${domain}/${LOCAL_SERVICE_LABEL}`;
    const loaded = await runCommand("/bin/launchctl", ["print", target]);
    if (loaded.success) {
      const restarted = await runCommand("/bin/launchctl", ["kickstart", "-k", target]);
      if (!restarted.success) {
        throw new Error(`本机服务启动失败：${restarted.stderr || restarted.stdout}`);
      }
      return;
    }
    const bootstrapped = await runCommand("/bin/launchctl", [
      "bootstrap",
      domain,
      this.#paths.launchAgentPath,
    ]);
    if (!bootstrapped.success) {
      throw new Error(`本机服务注册失败：${bootstrapped.stderr || bootstrapped.stdout}`);
    }
    const started = await runCommand("/bin/launchctl", ["kickstart", "-k", target]);
    if (!started.success) {
      throw new Error(`本机服务启动失败：${started.stderr || started.stdout}`);
    }
  }

  #dshPath(): string {
    return `${this.#paths.harnessDirectory}/node_modules/@deepseek-ai/dsh/lib/bin.js`;
  }

  #dshManifestPath(): string {
    return `${this.#paths.harnessDirectory}/node_modules/@deepseek-ai/dsh/package.json`;
  }

  #servicePath(): string {
    return [
      `${this.#paths.nodeDirectory}/bin`,
      `${this.#paths.pnpmDirectory}/node_modules/.bin`,
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
    ].join(":");
  }
}

/** Resolve the standard local-service paths for the current user. */
export function resolveLocalServicePaths(home = homeDirectory()): LocalServicePaths {
  const base = `${appDataDirectory()}/local-service`;
  return {
    base,
    nodeDirectory: `${base}/node`,
    harnessDirectory: `${base}/harness`,
    pnpmDirectory: `${base}/pnpm`,
    dshHome: `${base}/home`,
    launchAgentPath: `${home}/Library/LaunchAgents/${LOCAL_SERVICE_LABEL}.plist`,
    logPath: `${base}/service.log`,
  };
}

/** Render the LaunchAgent property list used by the macOS local service. */
export function buildLaunchAgentPlist(options: LaunchAgentOptions): string {
  const environment = {
    DSH_HOME: options.dshHome,
    PATH: options.path,
    NPM_CONFIG_REGISTRY: "https://registry.npmjs.org",
  };
  const environmentXml = Object.entries(environment)
    .map(([key, value]) =>
      `    <key>${escapeXml(key)}</key>\n    <string>${escapeXml(value)}</string>`
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(options.label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(options.nodePath)}</string>
    <string>${escapeXml(options.dshPath)}</string>
    <string>web</string>
    <string>--host</string>
    <string>${escapeXml(options.host)}</string>
    <string>--port</string>
    <string>${String(options.port)}</string>
    <string>--no-open</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${environmentXml}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>WorkingDirectory</key>
  <string>${escapeXml(options.workingDirectory)}</string>
  <key>StandardOutPath</key>
  <string>${escapeXml(options.logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(options.logPath)}</string>
</dict>
</plist>
`;
}

/** Poll the local web endpoint until it becomes healthy. */
export async function waitForHealth(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isHealthy(url)) return true;
    await delay(500);
  }
  return false;
}

async function waitForAuthenticatedUrl(
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

async function isHealthy(url: string): Promise<boolean> {
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

async function readLocalNodeVersion(nodeDirectory: string): Promise<string> {
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

async function readPackageVersion(manifestPath: string): Promise<string> {
  try {
    const manifest = JSON.parse(await Deno.readTextFile(manifestPath)) as { version?: unknown };
    return typeof manifest.version === "string" ? manifest.version : "";
  } catch {
    return "";
  }
}

async function readJsonFile(path: string): Promise<Record<string, unknown>> {
  try {
    const value = JSON.parse(await Deno.readTextFile(path)) as unknown;
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readTextFile(path: string): Promise<string> {
  try {
    return await Deno.readTextFile(path);
  } catch {
    return "";
  }
}

async function readAuthenticatedUrl(logPath: string): Promise<string | null> {
  return parseAuthenticatedUrl(await readTextFile(logPath));
}

/** Extract the latest one-time Web login URL emitted by DSH. */
export function parseAuthenticatedUrl(log: string): string | null {
  const matches = log.matchAll(/dsh web:\s+(http:\/\/127\.0\.0\.1:3080\/\?token=[^\s]+)/g);
  const match = [...matches].at(-1);
  return match?.[1] ?? null;
}

function launchDomain(): string {
  return `gui/${Deno.uid()}`;
}

function homeDirectory(): string {
  const home = Deno.env.get("HOME");
  if (!home) throw new Error("无法确定当前用户的主目录。");
  return home;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&" + "amp;")
    .replaceAll("<", "&" + "lt;")
    .replaceAll(">", "&" + "gt;")
    .replaceAll('"', "&" + "quot;")
    .replaceAll("'", "&" + "apos;");
}

function commandEnvironment(extra: Record<string, string>): Record<string, string> {
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

async function runCommand(
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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
