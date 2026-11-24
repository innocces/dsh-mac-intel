import { defaultProfile } from "../src/config.ts";
import { Logger } from "../src/logger.ts";
import { ServiceClient } from "../src/service-client.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

Deno.test("managed updates require a configured SSH profile", async () => {
  const client = new ServiceClient(defaultProfile(), new Logger());
  const result = await client.update("update-plugin");
  assert(!result.success, "an empty SSH profile must not start an update");
  assert(
    result.message.includes("SSH 服务器或 OpenSSH 主机别名"),
    "the missing SSH configuration should be explained",
  );
  await assertRejects(
    () => client.status(),
    "an empty SSH profile must not execute the remote status helper",
  );
});

async function assertRejects(action: () => Promise<unknown>, message: string): Promise<void> {
  try {
    await action();
  } catch {
    return;
  }
  throw new Error(message);
}
