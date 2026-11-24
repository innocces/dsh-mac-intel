import type { LocalServiceState } from "./types.ts";
import { Logger } from "./logger.ts";
import { DSH_BOOTSTRAP_VERSION, OFM_BOOTSTRAP_VERSION } from "./types.ts";
import {
  DSH_WEB_HOST,
  DSH_WEB_PORT,
  LOCAL_CLEANUP_LABEL,
  LOCAL_NODE_SHA256,
  LOCAL_NODE_URL,
  LOCAL_NODE_VERSION,
  LOCAL_SERVICE_LABEL,
  LOCAL_TEMP_ACTIVE_GRACE_MS,
  LOCAL_TEMP_MAX_BYTES,
  LOCAL_TEMP_STALE_MS,
} from "./constants.ts";
import {
  assertFreeDiskSpace,
  type LocalServicePaths,
  resolveLocalServicePaths,
  writeLocalServiceLaunchAgents,
} from "./local-service-storage.ts";
import { cleanupLocalServiceStorage } from "./local-service-cleanup.ts";
import {
  commandEnvironment,
  fileExists,
  isHealthy,
  isRecord,
  readAuthenticatedUrl,
  readJsonFile,
  readLocalNodeVersion,
  readPackageVersion,
  readTextFile,
  reloadLaunchAgent,
  runCommand,
  waitForAuthenticatedUrl,
} from "./local-service-runtime.ts";

export {
  buildCleanupLaunchAgentPlist,
  buildLaunchAgentPlist,
  parseAuthenticatedUrl,
  resolveLocalServicePaths,
} from "./local-service-storage.ts";
export { buildStorageCleanupScript, cleanupLocalServiceStorage } from "./local-service-cleanup.ts";

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
    await this.#stopCleanupAgent();
    await this.#cleanupStorage();
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
      await Deno.mkdir(this.#paths.tempDirectory, { recursive: true, mode: 0o700 });
      await this.#cleanupStorage();
      await assertFreeDiskSpace(this.#paths.base);
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
      await this.#launchCleanupAgent();
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
          TMPDIR: this.#paths.tempDirectory,
          TMP: this.#paths.tempDirectory,
          TEMP: this.#paths.tempDirectory,
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
          TMPDIR: this.#paths.tempDirectory,
          TMP: this.#paths.tempDirectory,
          TEMP: this.#paths.tempDirectory,
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
          TMPDIR: this.#paths.tempDirectory,
          TMP: this.#paths.tempDirectory,
          TEMP: this.#paths.tempDirectory,
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
    await writeLocalServiceLaunchAgents({
      paths: this.#paths,
      nodePath: `${this.#paths.nodeDirectory}/bin/node`,
      dshPath: this.#dshPath(),
      servicePath: this.#servicePath(),
      host: DSH_WEB_HOST,
      port: DSH_WEB_PORT,
    });
  }

  async #launchCleanupAgent(): Promise<void> {
    const domain = launchDomain();
    await reloadLaunchAgent(
      domain,
      `${domain}/${LOCAL_CLEANUP_LABEL}`,
      this.#paths.cleanupLaunchAgentPath,
      "临时文件清理任务",
    );
  }

  async #stopCleanupAgent(): Promise<void> {
    const result = await runCommand("/bin/launchctl", [
      "bootout",
      `${launchDomain()}/${LOCAL_CLEANUP_LABEL}`,
    ]);
    if (
      !result.success &&
      !/could not find service|not found|no service/i.test(result.stderr)
    ) {
      this.#logger.warn(`Temporary-file cleanup agent could not be stopped: ${result.stderr}`);
    }
  }

  async #cleanupStorage(): Promise<void> {
    const result = await cleanupLocalServiceStorage({
      tempDirectory: this.#paths.tempDirectory,
      dshHome: this.#paths.dshHome,
      maxBytes: LOCAL_TEMP_MAX_BYTES,
      staleAfterMs: LOCAL_TEMP_STALE_MS,
      activeGraceMs: LOCAL_TEMP_ACTIVE_GRACE_MS,
    });
    if (result.removedEntries > 0) {
      this.#logger.info(
        `Removed ${result.removedEntries} stale local-service artifacts (${result.removedBytes} bytes).`,
      );
    }
  }

  async #launchAgent(): Promise<void> {
    const domain = launchDomain();
    await reloadLaunchAgent(
      domain,
      `${domain}/${LOCAL_SERVICE_LABEL}`,
      this.#paths.launchAgentPath,
      "本机服务",
    );
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

function launchDomain(): string {
  return `gui/${Deno.uid()}`;
}
