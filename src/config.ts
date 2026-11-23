import type { AppConfig, AppProfile, Shortcut } from "./types.ts";

const CONFIG_SCHEMA_VERSION = 2 as const;

/** Built-in shortcuts for the most useful official DSH and plugin surfaces. */
export const DEFAULT_SHORTCUTS: Shortcut[] = [
  {
    id: "plugins",
    label: "插件管理",
    group: "插件",
    kind: "panel",
    target: "plugins",
    matchText: ["插件", "Plugins"],
    url: "",
  },
  {
    id: "our-free-model",
    label: "Our Free Model",
    group: "插件",
    kind: "text",
    target: "@ebony-vinyl/dsh-our-free-model",
    matchText: ["Our Free Model", "我们的免费模型", "免费模型"],
    url: "",
  },
  {
    id: "plugin-market",
    label: "插件市场",
    group: "插件",
    kind: "panel",
    target: "plugin-market",
    matchText: ["插件市场", "Plugin Market", "Marketplace"],
    url: "",
  },
  {
    id: "plugin-update",
    label: "插件升级",
    group: "插件",
    kind: "text",
    target: "plugin-update",
    matchText: ["检查更新", "立即升级", "插件升级", "Check for updates", "Update now"],
    url: "",
  },
  {
    id: "mcp",
    label: "MCP 服务",
    group: "能力",
    kind: "text",
    target: "mcp",
    matchText: ["MCP", "MCP 服务", "MCP Servers"],
    url: "",
  },
  {
    id: "skills",
    label: "技能",
    group: "能力",
    kind: "panel",
    target: "skills",
    matchText: ["技能", "Skills"],
    url: "",
  },
  {
    id: "schedules",
    label: "定时任务",
    group: "工作台",
    kind: "panel",
    target: "schedules",
    matchText: ["定时任务", "任务", "Schedules", "Tasks"],
    url: "",
  },
  {
    id: "terminal",
    label: "终端",
    group: "工作台",
    kind: "text",
    target: "terminal",
    matchText: ["终端", "Terminal"],
    url: "",
  },
  {
    id: "settings",
    label: "设置",
    group: "工作台",
    kind: "panel",
    target: "settings",
    matchText: ["设置", "Settings"],
    url: "",
  },
];

/** Return the default profile used before a remote service is configured. */
export function defaultProfile(): AppProfile {
  return {
    id: "default",
    name: "SSH 服务",
    transport: "ssh",
    webUrl: "",
    ssh: {
      host: "",
      user: "",
      port: 22,
      identityFile: "",
      remotePort: 3080,
      localPort: 3080,
      servicePath: "~/.local/share/dsh-mac-intel/bin/dsh-mac-intel-service",
    },
  };
}

/** Return a fresh default configuration. */
export function defaultConfig(): AppConfig {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    activeProfileId: "default",
    profiles: [defaultProfile()],
    shortcuts: DEFAULT_SHORTCUTS.map((shortcut) => ({
      ...shortcut,
      matchText: [...shortcut.matchText],
    })),
    updates: {
      autoCheck: true,
      checkIntervalHours: 24,
      autoUpdatePlugin: false,
      autoUpdateHarness: false,
    },
  };
}

/** Normalize and validate data read from disk or received from the UI. */
export function normalizeConfig(value: unknown): AppConfig {
  const fallback = defaultConfig();
  if (!isRecord(value)) return fallback;
  const rawSchemaVersion = typeof value.schemaVersion === "number" ? value.schemaVersion : 0;
  const profiles = Array.isArray(value.profiles)
    ? value.profiles.map(normalizeProfile).filter((profile): profile is AppProfile =>
      profile !== null
    )
    : fallback.profiles;
  let safeProfiles = profiles.length > 0 ? profiles : fallback.profiles;
  if (rawSchemaVersion < 2) {
    safeProfiles = safeProfiles.map(migrateLegacyProfile);
  }
  const requestedProfileId = typeof value.activeProfileId === "string" ? value.activeProfileId : "";
  const activeProfileId = safeProfiles.some((profile) => profile.id === requestedProfileId)
    ? requestedProfileId
    : safeProfiles[0].id;
  const shortcuts = Array.isArray(value.shortcuts)
    ? value.shortcuts.map(normalizeShortcut).filter((shortcut): shortcut is Shortcut =>
      shortcut !== null
    )
    : fallback.shortcuts;
  const rawUpdates = isRecord(value.updates) ? value.updates : {};

  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    activeProfileId,
    profiles: safeProfiles,
    shortcuts,
    updates: {
      autoCheck: typeof rawUpdates.autoCheck === "boolean"
        ? rawUpdates.autoCheck
        : fallback.updates.autoCheck,
      checkIntervalHours: clampNumber(
        rawUpdates.checkIntervalHours,
        1,
        168,
        fallback.updates.checkIntervalHours,
      ),
      autoUpdatePlugin: typeof rawUpdates.autoUpdatePlugin === "boolean"
        ? rawUpdates.autoUpdatePlugin
        : fallback.updates.autoUpdatePlugin,
      autoUpdateHarness: typeof rawUpdates.autoUpdateHarness === "boolean"
        ? rawUpdates.autoUpdateHarness
        : fallback.updates.autoUpdateHarness,
    },
  };
}

/** Resolve the macOS application-support directory used for settings and logs. */
export function appDataDirectory(): string {
  const home = Deno.env.get("HOME");
  if (!home) return ".dsh-mac-intel";
  if (Deno.build.os === "darwin") {
    return `${home}/Library/Application Support/DSH Intel`;
  }
  return `${home}/.local/share/dsh-mac-intel`;
}

/** Resolve the configuration file path. */
export function configPath(): string {
  return `${appDataDirectory()}/config.json`;
}

/** Resolve the rotating diagnostic log path. */
export function logPath(): string {
  return `${appDataDirectory()}/desktop.log`;
}

/** Load the persisted configuration, falling back to safe defaults. */
export async function loadConfig(path = configPath()): Promise<AppConfig> {
  try {
    const raw = await Deno.readTextFile(path);
    return normalizeConfig(JSON.parse(raw));
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
    return defaultConfig();
  }
}

/** Persist configuration atomically so an interrupted write cannot corrupt it. */
export async function saveConfig(config: AppConfig, path = configPath()): Promise<void> {
  const normalized = normalizeConfig(config);
  const directory = path.slice(0, Math.max(0, path.lastIndexOf("/")));
  await Deno.mkdir(directory, { recursive: true });
  const temporaryPath = `${path}.${Deno.pid}.tmp`;
  await Deno.writeTextFile(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`);
  await Deno.rename(temporaryPath, path);
}

/** Return the active profile or a safe local fallback. */
export function activeProfile(config: AppConfig): AppProfile {
  return config.profiles.find((profile) => profile.id === config.activeProfileId) ??
    config.profiles[0];
}

/** Validate a profile and normalize user-entered values. */
export function normalizeProfile(value: unknown): AppProfile | null {
  if (!isRecord(value)) return null;
  const id = cleanIdentifier(value.id);
  if (!id) return null;
  const transport = value.transport === "ssh" ? "ssh" : "https";
  const rawSsh = isRecord(value.ssh) ? value.ssh : {};
  const ssh = {
    host: cleanHost(typeof rawSsh.host === "string" ? rawSsh.host : ""),
    user: cleanUser(typeof rawSsh.user === "string" ? rawSsh.user : ""),
    port: clampNumber(rawSsh.port, 1, 65535, 22),
    identityFile: typeof rawSsh.identityFile === "string" ? rawSsh.identityFile.trim() : "",
    remotePort: clampNumber(rawSsh.remotePort, 1, 65535, 3080),
    localPort: clampNumber(rawSsh.localPort, 1, 65535, 3080),
    servicePath: cleanServicePath(
      typeof rawSsh.servicePath === "string"
        ? rawSsh.servicePath
        : defaultProfile().ssh.servicePath,
    ),
  };
  const webUrl = cleanUrl(typeof value.webUrl === "string" ? value.webUrl : "");
  return {
    id,
    name: cleanLabel(typeof value.name === "string" ? value.name : id),
    transport,
    webUrl,
    ssh,
  };
}

/** Move the untouched v1 loopback placeholder to the recommended SSH workflow. */
function migrateLegacyProfile(profile: AppProfile): AppProfile {
  const isUntouchedLoopbackPlaceholder = profile.name === "本机服务" &&
    profile.transport === "https" &&
    profile.webUrl === "http://127.0.0.1:3080" &&
    profile.ssh.host === "" &&
    profile.ssh.user === "";
  if (!isUntouchedLoopbackPlaceholder) return profile;
  return {
    ...profile,
    name: "SSH 服务",
    transport: "ssh",
    webUrl: "",
  };
}

/** Normalize a shortcut received from the control center. */
export function normalizeShortcut(value: unknown): Shortcut | null {
  if (!isRecord(value)) return null;
  const id = cleanIdentifier(value.id);
  const label = cleanLabel(typeof value.label === "string" ? value.label : "");
  const kind = value.kind === "url" || value.kind === "text" ? value.kind : "panel";
  const target = typeof value.target === "string" ? value.target.trim().slice(0, 200) : "";
  const matchText = Array.isArray(value.matchText)
    ? value.matchText
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 12)
    : [];
  const url = cleanUrl(typeof value.url === "string" ? value.url : "");
  if (!id || !label || (kind === "url" && !url)) return null;
  return {
    id,
    label,
    group: cleanLabel(
      typeof value.group === "string" && value.group.trim() ? value.group : "自定义",
    ),
    kind,
    target,
    matchText,
    url,
  };
}

function cleanIdentifier(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  return normalized.slice(0, 80);
}

function cleanLabel(value: string): string {
  return [...value.trim()]
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 0x20 && codePoint !== 0x7f;
    })
    .join("")
    .slice(0, 80);
}

/** SSH hosts may not begin with a dash or contain shell metacharacters. */
export function cleanHost(value: string): string {
  const normalized = value.trim();
  if (!/^[a-zA-Z0-9._:@[\]-]+$/.test(normalized) || normalized.startsWith("-")) return "";
  return normalized;
}

/** SSH users may not begin with a dash or contain shell metacharacters. */
export function cleanUser(value: string): string {
  const normalized = value.trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(normalized) || normalized.startsWith("-")) return "";
  return normalized;
}

/** Only allow a conservative absolute or home-relative managed-service path. */
export function cleanServicePath(value: string): string {
  const normalized = value.trim();
  if (!/^(~\/[a-zA-Z0-9._/-]+|\/[a-zA-Z0-9._/-]+)$/.test(normalized)) {
    return defaultProfile().ssh.servicePath;
  }
  return normalized;
}

/** Only allow http(s) URLs; no credentials or javascript schemes are accepted. */
export function cleanUrl(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "";
  try {
    const url = new URL(normalized);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (url.username || url.password) return "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function clampNumber(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(numeric)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
