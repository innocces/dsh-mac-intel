import type { EnvironmentFinding, EnvironmentReport } from "./types.ts";

/** Detect local prerequisites and explain which ones are optional. */
export async function detectEnvironment(): Promise<EnvironmentReport> {
  const findings: EnvironmentFinding[] = [];
  const denoVersion = typeof Deno.desktopVersion === "string"
    ? Deno.desktopVersion
    : Deno.version.deno;
  const nodeVersion = await commandVersion(["node", "--version"]);
  const sshAvailable = await commandExists("ssh");
  const platform = `${Deno.build.os} ${Deno.build.arch}`;
  const isMacIntel = Deno.build.os === "darwin" && Deno.build.arch === "x86_64";

  findings.push({
    id: "platform",
    label: "运行平台",
    status: Deno.build.os === "darwin" ? (isMacIntel ? "ok" : "warning") : "error",
    detail: isMacIntel ? "macOS Intel (x86_64)" : `${platform}；本项目发布目标为 macOS Intel`,
    required: true,
  });
  findings.push({
    id: "deno",
    label: "Deno 运行时",
    status: "ok",
    detail: `${denoVersion}；桌面应用已内置运行时`,
    required: true,
  });
  findings.push({
    id: "node",
    label: "Node.js",
    status: nodeVersion ? "ok" : "warning",
    detail: nodeVersion
      ? `${nodeVersion}；仅远程服务安装脚本需要，桌面端不依赖 Node`
      : "未检测到 Node.js；桌面端无需安装，远程服务脚本可自动下载隔离运行时",
    required: false,
  });
  findings.push({
    id: "ssh",
    label: "SSH 客户端",
    status: sshAvailable ? "ok" : "warning",
    detail: sshAvailable
      ? "可用于连接常驻 DSH 服务及执行安全更新命令"
      : "未检测到 SSH；使用 HTTPS 直连时仍可打开 Harness，但远程更新不可用",
    required: false,
  });

  return {
    platform,
    architecture: Deno.build.arch,
    denoVersion,
    nodeVersion,
    sshAvailable,
    findings,
  };
}

/** Return the first line of a command's version output, if it is available. */
export async function commandVersion(command: string[]): Promise<string> {
  try {
    const output = await new Deno.Command(command[0], {
      args: command.slice(1),
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!output.success) return "";
    return new TextDecoder().decode(output.stdout).trim().split("\n")[0] ?? "";
  } catch {
    return "";
  }
}

/** Check whether an executable can be resolved on PATH. */
export async function commandExists(command: string): Promise<boolean> {
  try {
    const output = await new Deno.Command(command, {
      args: ["--version"],
      stdout: "null",
      stderr: "null",
    }).output();
    return output.success;
  } catch {
    return false;
  }
}
