import { dirname, join } from "node:path";
import type { CdpClient } from "./cdp.ts";
import { decodeBase64 } from "./runtime.ts";

/** A decoded screencast frame. */
interface ScreencastFrame {
  data: string;
  timestamp: number;
  sessionId: number;
}

/** Records Chrome screencast frames and assembles them into an MP4. */
export class ScreencastRecorder {
  readonly #frames: ScreencastFrame[] = [];
  readonly #writes: Promise<void>[] = [];
  #directory: string | undefined;

  /** Start recording visual changes from the active page. */
  async start(client: CdpClient): Promise<void> {
    this.#directory = await Deno.makeTempDir({ prefix: "dsh-intel-video-" });
    client.on("Page.screencastFrame", (params) => {
      const data = String(params.data ?? "");
      const metadata = params.metadata as Record<string, unknown> | undefined;
      const sessionId = Number(params.sessionId ?? 0);
      const timestamp = Number(metadata?.timestamp ?? 0);
      if (!data) return;
      const frame: ScreencastFrame = { data, timestamp, sessionId };
      this.#frames.push(frame);
      const index = String(this.#frames.length).padStart(6, "0");
      this.#writes.push(
        Deno.writeFile(join(this.#directory!, `frame-${index}.jpg`), decodeBase64(data)),
      );
      void client.send("Page.screencastFrameAck", { sessionId });
    });
    await client.send("Page.startScreencast", {
      format: "jpeg",
      quality: 90,
      maxWidth: 1440,
      maxHeight: 1000,
      everyNthFrame: 1,
    });
  }

  /** Stop recording and wait until every frame has reached disk. */
  async stop(client: CdpClient): Promise<void> {
    await client.send("Page.stopScreencast");
    await Promise.all(this.#writes);
  }

  /** Assemble the captured frames into a broadly compatible MP4 file. */
  async write(output: string): Promise<void> {
    if (this.#frames.length < 2) throw new Error("Chrome produced too few screencast frames.");
    if (!this.#directory) throw new Error("The screencast recorder was not started.");
    const ffmpeg = await findFfmpeg();
    const manifest = join(this.#directory, "frames.txt");
    const lines: string[] = [];
    for (let index = 0; index < this.#frames.length; index += 1) {
      const current = this.#frames[index];
      const next = this.#frames[index + 1];
      const duration = next
        ? Math.min(0.5, Math.max(0.033, next.timestamp - current.timestamp))
        : 0.5;
      lines.push(`file 'frame-${String(index + 1).padStart(6, "0")}.jpg'`);
      lines.push(`duration ${duration.toFixed(3)}`);
    }
    lines.push(`file 'frame-${String(this.#frames.length).padStart(6, "0")}.jpg'`);
    await Deno.writeTextFile(manifest, `${lines.join("\n")}\n`);
    await Deno.mkdir(dirname(output), { recursive: true });
    const command = await new Deno.Command(ffmpeg, {
      args: [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        manifest,
        "-vf",
        "scale=1440:1000:force_original_aspect_ratio=decrease:flags=lanczos," +
        "pad=1440:1000:(ow-iw)/2:(oh-ih)/2:color=0x151517,fps=30,format=yuv420p",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "22",
        "-movflags",
        "+faststart",
        output,
      ],
      stdout: "null",
      stderr: "piped",
    }).output();
    if (!command.success) {
      throw new Error(
        new TextDecoder().decode(command.stderr) || "ffmpeg could not create the MP4.",
      );
    }
    await Deno.remove(this.#directory, { recursive: true });
    this.#directory = undefined;
  }

  /** Number of captured frames. */
  get frameCount(): number {
    return this.#frames.length;
  }
}

/** Locate ffmpeg for video assembly. */
async function findFfmpeg(): Promise<string> {
  for (
    const candidate of ["/usr/local/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg", "/usr/bin/ffmpeg"]
  ) {
    try {
      const info = await Deno.stat(candidate);
      if (info.isFile) return candidate;
    } catch {
      // Try the next ffmpeg candidate.
    }
  }
  const command = await new Deno.Command("ffmpeg", {
    args: ["-version"],
    stdout: "null",
    stderr: "null",
  }).output();
  if (!command.success) throw new Error("ffmpeg is required to record the E2E walkthrough.");
  return "ffmpeg";
}
