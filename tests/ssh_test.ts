import { buildSshCommandArgs, buildSshTarget, parseServiceStatus } from "../src/ssh.ts";
import type { AppProfile } from "../src/types.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEquals<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
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

Deno.test("SSH host aliases can own their user and port configuration", () => {
  const profile: AppProfile = {
    id: "alias",
    name: "Alias",
    transport: "ssh",
    webUrl: "",
    ssh: {
      host: "dsh-server",
      user: "",
      port: 22,
      identityFile: "",
      remotePort: 3080,
      localPort: 3080,
      servicePath: "~/.local/share/dsh-mac-intel/bin/dsh-mac-intel-service",
    },
  };
  assertEquals(buildSshTarget(profile), "dsh-server");
  const args = buildSshCommandArgs(profile);
  assert(args.includes("dsh-server"), "the OpenSSH alias should be used as the destination");
  assert(!args.includes("-p"), "the default port should be left to ~/.ssh/config");
});

Deno.test("SSH service command places the destination before the remote command", () => {
  const profile: AppProfile = {
    id: "remote",
    name: "Remote",
    transport: "ssh",
    webUrl: "",
    ssh: {
      host: "dsh.example.com",
      user: "dsh",
      port: 2222,
      identityFile: "~/.ssh/id_ed25519",
      remotePort: 3080,
      localPort: 3080,
      servicePath: "~/.local/share/dsh-mac-intel/bin/dsh-mac-intel-service",
    },
  };
  const args = buildSshCommandArgs(profile, [profile.ssh.servicePath, "status"]);
  const destinationIndex = args.indexOf("dsh@dsh.example.com");
  const commandIndex = args.indexOf(profile.ssh.servicePath);
  assert(destinationIndex >= 0, "SSH destination is missing");
  assert(commandIndex > destinationIndex, "remote command must follow the SSH destination");
  const home = Deno.env.get("HOME") ?? "";
  assert(
    args.includes(`${home}/.ssh/id_ed25519`),
    "local identity-file path should expand the home directory",
  );
});
