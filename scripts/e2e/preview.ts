import { join } from "node:path";
import { pause } from "./runtime.ts";

/** Start the deterministic control-center preview server. */
export function startPreviewServer(root: string, port: number): Deno.ChildProcess {
  return new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-env",
      "--allow-net=127.0.0.1",
      "--allow-read",
      "--allow-write",
      join(root, "scripts/preview_server.ts"),
      `--port=${port}`,
    ],
    cwd: root,
    stdout: "null",
    stderr: "piped",
  }).spawn();
}

/** Wait for the local preview server to answer its health check. */
export async function waitForServer(url: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The preview server is still starting.
    }
    await pause(100);
  }
  throw new Error(`Preview server did not start at ${url}`);
}
