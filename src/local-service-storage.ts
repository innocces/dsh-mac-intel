import { appDataDirectory } from "./config.ts";
import {
  LOCAL_CLEANUP_INTERVAL_SECONDS,
  LOCAL_CLEANUP_LABEL,
  LOCAL_INSTALL_MIN_FREE_BYTES,
  LOCAL_SERVICE_LABEL,
  LOCAL_TEMP_ACTIVE_GRACE_MS,
  LOCAL_TEMP_MAX_BYTES,
  LOCAL_TEMP_STALE_MS,
} from "./constants.ts";
import { buildStorageCleanupScript } from "./local-service-cleanup.ts";

/** Filesystem locations used by the optional macOS local service. */
export interface LocalServicePaths {
  base: string;
  nodeDirectory: string;
  harnessDirectory: string;
  pnpmDirectory: string;
  dshHome: string;
  tempDirectory: string;
  cleanupScriptPath: string;
  cleanupLogPath: string;
  launchAgentPath: string;
  cleanupLaunchAgentPath: string;
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
  tempDirectory: string;
  logPath: string;
}

/** Values required to write both local-service LaunchAgent files. */
export interface WriteLaunchAgentsOptions {
  paths: LocalServicePaths;
  nodePath: string;
  dshPath: string;
  servicePath: string;
  host: string;
  port: number;
}

/** Values required to render the periodic storage-cleanup LaunchAgent. */
export interface CleanupLaunchAgentOptions {
  label: string;
  nodePath: string;
  scriptPath: string;
  logPath: string;
  intervalSeconds: number;
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
    tempDirectory: `${base}/tmp`,
    cleanupScriptPath: `${base}/cleanup-storage.mjs`,
    cleanupLogPath: `${base}/cleanup.log`,
    launchAgentPath: `${home}/Library/LaunchAgents/${LOCAL_SERVICE_LABEL}.plist`,
    cleanupLaunchAgentPath: `${home}/Library/LaunchAgents/${LOCAL_CLEANUP_LABEL}.plist`,
    logPath: `${base}/service.log`,
  };
}

/** Render the LaunchAgent property list used by the macOS local service. */
export function buildLaunchAgentPlist(options: LaunchAgentOptions): string {
  const environment = {
    DSH_HOME: options.dshHome,
    PATH: options.path,
    NPM_CONFIG_REGISTRY: "https://registry.npmjs.org",
    TMPDIR: options.tempDirectory,
    TMP: options.tempDirectory,
    TEMP: options.tempDirectory,
  };
  return renderPlist({
    label: options.label,
    programArguments: [
      options.nodePath,
      options.dshPath,
      "web",
      "--host",
      options.host,
      "--port",
      String(options.port),
      "--no-open",
    ],
    environment,
    runAtLoad: true,
    keepAlive: true,
    throttleInterval: 5,
    workingDirectory: options.workingDirectory,
    standardOutPath: options.logPath,
    standardErrorPath: options.logPath,
  });
}

/** Render the periodic cleanup LaunchAgent used by the local service. */
export function buildCleanupLaunchAgentPlist(options: CleanupLaunchAgentOptions): string {
  return renderPlist({
    label: options.label,
    programArguments: [options.nodePath, options.scriptPath],
    environment: {},
    runAtLoad: true,
    keepAlive: false,
    startInterval: options.intervalSeconds,
    standardOutPath: options.logPath,
    standardErrorPath: options.logPath,
  });
}

/** Write the service and periodic-cleanup LaunchAgent files. */
export async function writeLocalServiceLaunchAgents(
  options: WriteLaunchAgentsOptions,
): Promise<void> {
  const { paths } = options;
  const launchAgents = `${homeDirectory()}/Library/LaunchAgents`;
  await Deno.mkdir(launchAgents, { recursive: true });
  const logFile = await Deno.open(paths.logPath, { create: true, append: true });
  logFile.close();
  await Deno.chmod(paths.logPath, 0o600);
  await Deno.truncate(paths.logPath, 0);
  const servicePlist = buildLaunchAgentPlist({
    label: LOCAL_SERVICE_LABEL,
    nodePath: options.nodePath,
    dshPath: options.dshPath,
    dshHome: paths.dshHome,
    path: options.servicePath,
    host: options.host,
    port: options.port,
    workingDirectory: paths.dshHome,
    tempDirectory: paths.tempDirectory,
    logPath: paths.logPath,
  });
  await Deno.writeTextFile(paths.launchAgentPath, servicePlist);

  const cleanupScript = buildStorageCleanupScript({
    tempDirectory: paths.tempDirectory,
    dshHome: paths.dshHome,
    maxBytes: LOCAL_TEMP_MAX_BYTES,
    staleAfterMs: LOCAL_TEMP_STALE_MS,
    activeGraceMs: LOCAL_TEMP_ACTIVE_GRACE_MS,
  });
  await Deno.writeTextFile(paths.cleanupScriptPath, cleanupScript);
  await Deno.chmod(paths.cleanupScriptPath, 0o700);
  const cleanupLog = await Deno.open(paths.cleanupLogPath, {
    create: true,
    append: true,
  });
  cleanupLog.close();
  await Deno.chmod(paths.cleanupLogPath, 0o600);
  await Deno.truncate(paths.cleanupLogPath, 0);
  const cleanupPlist = buildCleanupLaunchAgentPlist({
    label: LOCAL_CLEANUP_LABEL,
    nodePath: options.nodePath,
    scriptPath: paths.cleanupScriptPath,
    logPath: paths.cleanupLogPath,
    intervalSeconds: LOCAL_CLEANUP_INTERVAL_SECONDS,
  });
  await Deno.writeTextFile(paths.cleanupLaunchAgentPath, cleanupPlist);
}

/** Refuse an installation when the target volume cannot safely hold its runtime. */
export async function assertFreeDiskSpace(
  path: string,
  requiredBytes = LOCAL_INSTALL_MIN_FREE_BYTES,
): Promise<void> {
  const output = await new Deno.Command("df", {
    args: ["-Pk", path],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) throw new Error("无法读取磁盘可用空间。");
  const lines = new TextDecoder().decode(output.stdout).trim().split("\n");
  const fields = lines.at(-1)?.trim().split(/\s+/) ?? [];
  const availableBlocks = Number(fields[3]);
  if (!Number.isFinite(availableBlocks)) throw new Error("无法解析磁盘可用空间。");
  const availableBytes = availableBlocks * 1024;
  if (availableBytes < requiredBytes) {
    throw new Error(
      `磁盘可用空间不足：至少需要 ${formatBytes(requiredBytes)}，当前只有 ${
        formatBytes(availableBytes)
      }。`,
    );
  }
}

/** Extract the latest one-time Web login URL emitted by DSH. */
export function parseAuthenticatedUrl(log: string): string | null {
  const matches = log.matchAll(/dsh web:\s+(http:\/\/127\.0\.0\.1:3080\/\?token=[^\s]+)/g);
  const match = [...matches].at(-1);
  return match?.[1] ?? null;
}

/** Return the current user's home directory. */
export function homeDirectory(): string {
  const home = Deno.env.get("HOME");
  if (!home) throw new Error("无法确定当前用户的主目录。");
  return home;
}

interface PlistOptions {
  label: string;
  programArguments: string[];
  environment: Record<string, string>;
  runAtLoad: boolean;
  keepAlive: boolean;
  throttleInterval?: number;
  startInterval?: number;
  workingDirectory?: string;
  standardOutPath: string;
  standardErrorPath: string;
}

function renderPlist(options: PlistOptions): string {
  const environmentXml = Object.entries(options.environment)
    .map(([key, value]) =>
      `    <key>${escapeXml(key)}</key>\n    <string>${escapeXml(value)}</string>`
    )
    .join("\n");
  const argumentsXml = options.programArguments
    .map((argument) => `    <string>${escapeXml(argument)}</string>`)
    .join("\n");
  const throttleXml = options.throttleInterval === undefined ? "" : `
  <key>ThrottleInterval</key>
  <integer>${options.throttleInterval}</integer>`;
  const startIntervalXml = options.startInterval === undefined ? "" : `
  <key>StartInterval</key>
  <integer>${options.startInterval}</integer>`;
  const workingDirectoryXml = options.workingDirectory === undefined ? "" : `
  <key>WorkingDirectory</key>
  <string>${escapeXml(options.workingDirectory)}</string>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(options.label)}</string>
  <key>ProgramArguments</key>
  <array>
${argumentsXml}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${environmentXml}
  </dict>
  <key>RunAtLoad</key>
  <${options.runAtLoad ? "true" : "false"}/>
  <key>KeepAlive</key>
  <${options.keepAlive ? "true" : "false"}/>${throttleXml}${startIntervalXml}${workingDirectoryXml}
  <key>StandardOutPath</key>
  <string>${escapeXml(options.standardOutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(options.standardErrorPath)}</string>
</dict>
</plist>
`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&" + "amp;")
    .replaceAll("<", "&" + "lt;")
    .replaceAll(">", "&" + "gt;")
    .replaceAll('"', "&" + "quot;")
    .replaceAll("'", "&" + "apos;");
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}
