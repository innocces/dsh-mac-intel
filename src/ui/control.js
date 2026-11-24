/**
 * @typedef {Object} ControlState
 * @property {Object} config
 * @property {Object} environment
 * @property {Object|null} service
 * @property {Object} appUpdate
 * @property {boolean} connected
 * @property {string} lastError
 */

/** @type {ControlState|null} */
let currentState = null;
/** @type {number|undefined} */
let toastTimer;

/** Deployment-independent defaults published by the official DSH and OpenSSH. */
const STANDARD_CONNECTION_CONFIG = Object.freeze({
  transport: "ssh",
  webUrl: "http://127.0.0.1:3080",
  sshPort: "22",
  remotePort: "3080",
  localPort: "3080",
  servicePath: "~/.local/share/dsh-mac-intel/bin/dsh-mac-intel-service",
});

const byId = /** @param {string} id */ (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  void refreshState();
});

function bindEvents() {
  byId("refresh-button").addEventListener("click", () => void refreshState());
  byId("check-updates-button").addEventListener("click", () => void checkUpdates());
  byId("check-desktop-button").addEventListener("click", () => void checkUpdates());
  byId("connect-button").addEventListener("click", () => void connectService());
  byId("open-harness-button").addEventListener("click", () => void openHarness());
  byId("control-button").addEventListener("click", () => void post("/api/open/control"));
  byId("save-settings-button").addEventListener("click", () => void saveSettings());
  byId("apply-standard-config-button").addEventListener("click", applyStandardConfig);
  byId("add-shortcut-button").addEventListener("click", openShortcutDialog);
  byId("transport-select").addEventListener("change", updateTransportFields);
  byId("ssh-host").addEventListener("input", updateUpdateAvailability);
  byId("ssh-user").addEventListener("input", updateUpdateAvailability);

  for (const button of document.querySelectorAll("[data-update]")) {
    button.addEventListener("click", () => {
      const component = button.getAttribute("data-update");
      if (component === "harness" || component === "plugin") {
        void runUpdate(component);
      }
    });
  }

  byId("shortcut-kind").addEventListener("change", updateShortcutKindFields);
  byId("shortcut-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void saveShortcut();
  });
}

/** Refresh all state from the local application process. */
async function refreshState() {
  try {
    const state = await getJson("/api/state");
    currentState = state;
    render(state);
    clearError();
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
}

function render(state) {
  renderConnection(state);
  renderVersions(state);
  renderShortcuts(state);
  renderEnvironment(state);
  populateSettings(state);
}

function renderConnection(state) {
  const connected = Boolean(state.connected);
  const label = connected ? "已连接" : "未连接";
  byId("connection-label").textContent = label;
  byId("sidebar-status").textContent = connected ? "Harness 已连接" : "等待连接服务";
  const dots = document.querySelectorAll("#connection-pill .status-dot, #sidebar-status-dot");
  for (const dot of dots) {
    dot.classList.remove("ok", "warning", "error");
    if (connected) dot.classList.add("ok");
    else dot.classList.add("warning");
  }
  const openButton = /** @type {HTMLButtonElement} */ (byId("open-harness-button"));
  openButton.textContent = connected ? "显示 Harness" : "连接并打开";
}

function renderVersions(state) {
  const service = state.service;
  const harnessInstalled = service?.harness?.installed ?? "—";
  const harnessLatest = service?.harness?.latest ?? "—";
  const pluginInstalled = service?.plugin?.installed ?? "—";
  const pluginLatest = service?.plugin?.latest ?? "—";

  byId("harness-version").textContent = harnessInstalled;
  byId("harness-detail").textContent = service?.service?.url || "尚未连接常驻服务";
  setStateLabel("harness-state", service?.ok ? "运行中" : "未连接", service?.ok ? "ok" : "warning");

  byId("plugin-version").textContent = pluginInstalled;
  byId("plugin-detail").textContent = `@ebony-vinyl/dsh-our-free-model · 最新 ${pluginLatest}`;
  setStateLabel(
    "plugin-state",
    service?.ok ? "已启用" : "等待安装",
    service?.ok ? "ok" : "warning",
  );

  const appVersion = state.appUpdate?.currentVersion ?? "—";
  byId("desktop-version").textContent = appVersion;
  byId("desktop-detail").textContent = state.appUpdate?.message ?? "Deno Desktop 原生运行时";
  const appState = state.appUpdate?.state ?? "idle";
  setStateLabel(
    "desktop-state",
    appState === "ready" ? "可更新" : appState === "failed" ? "更新失败" : "已内置",
    appState === "ready" ? "warning" : appState === "failed" ? "error" : "ok",
  );

  byId("update-harness-installed").textContent = harnessInstalled;
  byId("update-harness-latest").textContent = harnessLatest;
  byId("update-plugin-installed").textContent = pluginInstalled;
  byId("update-plugin-latest").textContent = pluginLatest;
  byId("update-desktop-installed").textContent = appVersion;
  byId("update-desktop-state").textContent = state.appUpdate?.stagedVersion
    ? `${state.appUpdate.stagedVersion} · 待重启`
    : state.appUpdate?.message ?? "等待检查";
}

function renderShortcuts(state) {
  const container = byId("shortcut-groups");
  container.replaceChildren();
  const groups = new Map();
  for (const shortcut of state.config.shortcuts ?? []) {
    const group = shortcut.group?.trim() || "自定义";
    const entries = groups.get(group) ?? [];
    entries.push(shortcut);
    groups.set(group, entries);
  }

  if (groups.size === 0) {
    const empty = document.createElement("p");
    empty.className = "fine-print";
    empty.textContent = "尚未配置快捷方式。";
    container.append(empty);
    return;
  }

  for (const [group, shortcuts] of groups) {
    const groupElement = document.createElement("div");
    groupElement.className = "shortcut-group";

    const title = document.createElement("div");
    title.className = "shortcut-group-title";
    title.textContent = group;

    const list = document.createElement("div");
    list.className = "shortcut-list";
    for (const shortcut of shortcuts) {
      const card = document.createElement("button");
      card.className = "shortcut-card";
      card.type = "button";
      card.title = shortcut.target || shortcut.url || shortcut.label;

      const copy = document.createElement("div");
      const label = document.createElement("strong");
      label.textContent = shortcut.label;
      const target = document.createElement("span");
      target.textContent = shortcut.kind === "url"
        ? shortcut.url
        : shortcut.target || shortcut.kind;
      copy.append(label, target);

      const remove = document.createElement("span");
      remove.className = "shortcut-remove";
      remove.setAttribute("role", "button");
      remove.setAttribute("aria-label", `移除 ${shortcut.label}`);
      remove.textContent = "×";
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        void removeShortcut(shortcut.id);
      });

      card.append(copy, remove);
      card.addEventListener("click", () => void activateShortcut(shortcut.id));
      list.append(card);
    }
    groupElement.append(title, list);
    container.append(groupElement);
  }
}

function renderEnvironment(state) {
  const environment = state.environment;
  byId("environment-platform").textContent =
    `${environment.platform} · Deno ${environment.denoVersion}`;
  const list = byId("environment-list");
  list.replaceChildren();

  for (const finding of environment.findings ?? []) {
    const row = document.createElement("div");
    row.className = "environment-row";

    const label = document.createElement("strong");
    label.textContent = finding.label;
    const detail = document.createElement("span");
    detail.textContent = finding.detail;
    const status = document.createElement("span");
    status.className = `environment-state ${finding.status}`;
    status.textContent = statusLabel(finding.status);

    row.append(label, detail, status);
    list.append(row);
  }
}

function populateSettings(state) {
  const config = state.config;
  const profile = config.profiles?.find((item) => item.id === config.activeProfileId) ??
    config.profiles?.[0];
  if (!profile) return;

  byId("transport-select").value = profile.transport ?? "https";
  byId("profile-name").value = profile.name ?? "DSH 服务";
  byId("web-url").value = profile.webUrl ?? "";
  byId("ssh-host").value = profile.ssh?.host ?? "";
  byId("ssh-user").value = profile.ssh?.user ?? "";
  byId("ssh-port").value = String(profile.ssh?.port ?? STANDARD_CONNECTION_CONFIG.sshPort);
  byId("ssh-identity").value = profile.ssh?.identityFile ?? "";
  byId("remote-port").value = String(
    profile.ssh?.remotePort ?? STANDARD_CONNECTION_CONFIG.remotePort,
  );
  byId("local-port").value = String(
    profile.ssh?.localPort ?? STANDARD_CONNECTION_CONFIG.localPort,
  );
  byId("service-path").value = profile.ssh?.servicePath ??
    STANDARD_CONNECTION_CONFIG.servicePath;
  byId("auto-check").checked = Boolean(config.updates?.autoCheck);
  byId("auto-plugin").checked = Boolean(config.updates?.autoUpdatePlugin);
  byId("auto-harness").checked = Boolean(config.updates?.autoUpdateHarness);
  updateTransportFields();
}

function updateTransportFields() {
  const ssh = byId("transport-select").value === "ssh";
  for (const element of document.querySelectorAll(".ssh-field")) {
    element.hidden = !ssh;
  }
  for (const element of document.querySelectorAll(".https-field")) {
    element.hidden = ssh;
  }
  updateUpdateAvailability();
}

/** Enable managed updates only when the SSH profile can reach the remote helper. */
function updateUpdateAvailability() {
  const config = currentState?.config;
  const profile = config?.profiles?.find((item) => item.id === config.activeProfileId) ??
    config?.profiles?.[0];
  const ready = profile?.transport === "ssh" &&
    Boolean(profile.ssh?.host?.trim());
  for (const button of document.querySelectorAll("[data-update]")) {
    /** @type {HTMLButtonElement} */ (button).disabled = !ready;
  }
  byId("update-requirement").textContent = ready
    ? "SSH 配置已就绪；更新将通过远程 dsh-mac-intel-service 辅助程序执行。"
    : "一键更新需要配置 SSH 连接，并在远程服务器安装 dsh-mac-intel-service 辅助程序。";
}

/** Apply the deployment-independent official defaults without replacing user-specific values. */
function applyStandardConfig() {
  byId("transport-select").value = STANDARD_CONNECTION_CONFIG.transport;
  byId("profile-name").value = "SSH 服务";
  byId("web-url").value = STANDARD_CONNECTION_CONFIG.webUrl;
  byId("ssh-port").value = STANDARD_CONNECTION_CONFIG.sshPort;
  byId("remote-port").value = STANDARD_CONNECTION_CONFIG.remotePort;
  byId("local-port").value = STANDARD_CONNECTION_CONFIG.localPort;
  byId("service-path").value = STANDARD_CONNECTION_CONFIG.servicePath;
  updateTransportFields();
  showToast("已填入官方标准配置；请填写服务器或 OpenSSH 主机别名。");
  byId("ssh-host").focus();
}

async function saveSettings() {
  if (!currentState) return false;
  const config = structuredClone(currentState.config);
  const profile = config.profiles.find((item) => item.id === config.activeProfileId) ??
    config.profiles[0];
  profile.name = byId("profile-name").value.trim() || "DSH 服务";
  profile.transport = byId("transport-select").value;
  profile.webUrl = byId("web-url").value.trim();
  profile.ssh.host = byId("ssh-host").value.trim();
  profile.ssh.user = byId("ssh-user").value.trim();
  profile.ssh.port = Number(byId("ssh-port").value) || Number(STANDARD_CONNECTION_CONFIG.sshPort);
  profile.ssh.identityFile = byId("ssh-identity").value.trim();
  profile.ssh.remotePort = Number(byId("remote-port").value) ||
    Number(STANDARD_CONNECTION_CONFIG.remotePort);
  profile.ssh.localPort = Number(byId("local-port").value) ||
    Number(STANDARD_CONNECTION_CONFIG.localPort);
  profile.ssh.servicePath = byId("service-path").value.trim();
  config.updates.autoCheck = byId("auto-check").checked;
  config.updates.autoUpdatePlugin = byId("auto-plugin").checked;
  config.updates.autoUpdateHarness = byId("auto-harness").checked;

  try {
    const result = await post("/api/config", config);
    currentState.config = result.config;
    populateSettings(currentState);
    showToast("连接设置已保存。");
    return true;
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function connectService() {
  if (!(await saveSettings())) return;
  const transport = byId("transport-select").value;
  const host = byId("ssh-host").value.trim();
  const webUrl = byId("web-url").value.trim();
  if (transport === "ssh" && !host) {
    showToast("请先填写 SSH 服务器或 ~/.ssh/config 中的 OpenSSH 主机别名。");
    byId("ssh-host").focus();
    return;
  }
  if (transport === "https" && !/^https?:\/\//i.test(webUrl)) {
    showToast("请先在连接设置中填写可访问的 HTTP(S) 地址。");
    byId("web-url").focus();
    return;
  }
  const button = /** @type {HTMLButtonElement} */ (byId("connect-button"));
  button.disabled = true;
  button.textContent = "正在连接…";
  try {
    const result = await post("/api/connect");
    if (!result.connected) throw new Error(result.message);
    showToast(result.message);
    await refreshState();
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  } finally {
    button.disabled = false;
    button.textContent = "连接服务";
  }
}

async function openHarness() {
  try {
    const result = await post("/api/open/harness");
    if (!result.connected) throw new Error(result.message);
    showToast(result.message);
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
}

async function checkUpdates() {
  const button = /** @type {HTMLButtonElement} */ (byId("check-updates-button"));
  button.disabled = true;
  try {
    const result = await post("/api/check-updates");
    if (!result.success) throw new Error(result.message);
    showToast(result.message);
    await refreshState();
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  } finally {
    button.disabled = false;
  }
}

async function runUpdate(component) {
  const buttons = document.querySelectorAll(`[data-update="${component}"]`);
  for (const button of buttons) {
    /** @type {HTMLButtonElement} */ (button).disabled = true;
  }
  try {
    const result = await post(`/api/update/${component}`);
    if (!result.success) throw new Error(result.message);
    showToast(result.message);
    await refreshState();
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  } finally {
    for (const button of buttons) {
      /** @type {HTMLButtonElement} */ (button).disabled = false;
    }
  }
}

async function activateShortcut(id) {
  try {
    const result = await post("/api/shortcut/activate", { id });
    if (!result.success) throw new Error(result.message);
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
}

async function removeShortcut(id) {
  if (!currentState) return;
  const config = structuredClone(currentState.config);
  config.shortcuts = config.shortcuts.filter((shortcut) => shortcut.id !== id);
  try {
    const result = await post("/api/config", config);
    currentState.config = result.config;
    renderShortcuts(currentState);
    showToast("快捷方式已移除。");
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
}

function openShortcutDialog() {
  byId("shortcut-form").reset();
  byId("shortcut-group").value = "自定义";
  updateShortcutKindFields();
  const dialog = /** @type {HTMLDialogElement} */ (byId("shortcut-dialog"));
  dialog.showModal();
  byId("shortcut-label").focus();
}

function updateShortcutKindFields() {
  const kind = byId("shortcut-kind").value;
  byId("shortcut-target-field").hidden = kind === "url";
  byId("shortcut-match-field").hidden = kind === "url";
  byId("shortcut-url-field").hidden = kind !== "url";
  byId("shortcut-target-field").required = kind !== "url";
  byId("shortcut-url-field").required = kind === "url";
}

async function saveShortcut() {
  if (!currentState) return;
  const kind = byId("shortcut-kind").value;
  const label = byId("shortcut-label").value.trim();
  const config = structuredClone(currentState.config);
  const id = `custom-${slug(label)}-${Date.now().toString(36)}`;
  config.shortcuts.push({
    id,
    label,
    group: byId("shortcut-group").value.trim() || "自定义",
    kind,
    target: kind === "url" ? "" : byId("shortcut-target").value.trim(),
    matchText: byId("shortcut-match").value.split(",").map((item) => item.trim()).filter(Boolean),
    url: kind === "url" ? byId("shortcut-url").value.trim() : "",
  });

  try {
    const result = await post("/api/config", config);
    currentState.config = result.config;
    renderShortcuts(currentState);
    byId("shortcut-dialog").close();
    showToast("快捷方式已添加。");
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
}

function setStateLabel(id, text, status) {
  const element = byId(id);
  element.textContent = text;
  element.classList.remove("ok", "warning", "error");
  if (status) element.classList.add(status);
}

function statusLabel(status) {
  if (status === "ok") return "正常";
  if (status === "warning") return "可选";
  if (status === "error") return "需处理";
  return "未知";
}

function slug(value) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "") ||
    "shortcut";
}

function showError(message) {
  byId("error-message").textContent = message;
  byId("error-notice").hidden = false;
  showToast(message, true);
}

function clearError() {
  byId("error-notice").hidden = true;
}

function showToast(message, isError = false) {
  const toast = byId("toast");
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.hidden = false;
  if (toastTimer !== undefined) globalThis.clearTimeout(toastTimer);
  toastTimer = globalThis.setTimeout(() => {
    toast.hidden = true;
  }, 4200);
}

/** @param {string} path */
async function getJson(path) {
  const response = await fetch(path, { headers: { accept: "application/json" } });
  const body = await response.json();
  if (!response.ok || body?.ok === false) throw new Error(body?.error || `HTTP ${response.status}`);
  return body;
}

/**
 * @param {string} path
 * @param {unknown} [body]
 */
async function post(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-dsh-intel-control": "1",
    },
    body: JSON.stringify(body ?? {}),
  });
  const result = await response.json();
  if (!response.ok || result?.ok === false) {
    throw new Error(result?.error || result?.message || `HTTP ${response.status}`);
  }
  return result;
}
