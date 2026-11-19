import { parseServiceStatus } from "../src/ssh.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

Deno.test("service status parser accepts JSON after diagnostic output", () => {
  const status = parseServiceStatus(
    'starting service\n{"ok":true,"service":{"active":true,"url":"http://127.0.0.1:3080"},"node":{"version":"v24.9.0"},"harness":{"installed":"0.2.2-rc.5","latest":"0.2.2-rc.5","updateAvailable":false},"plugin":{"installed":"2.8.5","latest":"2.8.5","updateAvailable":false},"message":"ok"}',
  );
  if (status === null) throw new Error("status was not parsed");
  assert(status.ok, "status should be healthy");
  assert(status.plugin.installed === "2.8.5", "plugin version was not preserved");
});

Deno.test("service status parser rejects non-JSON output", () => {
  assert(parseServiceStatus("service unavailable") === null, "invalid output should not parse");
});
