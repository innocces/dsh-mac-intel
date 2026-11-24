import {
  buildCleanupLaunchAgentPlist,
  buildLaunchAgentPlist,
  buildStorageCleanupScript,
  cleanupLocalServiceStorage,
  parseAuthenticatedUrl,
  resolveLocalServicePaths,
} from "../src/local-service.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEquals<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test("local service LaunchAgent binds the official loopback endpoint", () => {
  const plist = buildLaunchAgentPlist({
    label: "com.example.dsh.service",
    nodePath: "/Users/test/Library/Application Support/node/bin/node",
    dshPath: "/Users/test/Library/Application Support/dsh/lib/bin.js",
    dshHome: "/Users/test & dev/Library/Application Support/dsh/home",
    path: "/node/bin:/pnpm/bin:/usr/bin:/bin",
    host: "127.0.0.1",
    port: 3080,
    workingDirectory: "/Users/test/Library/Application Support/dsh/home",
    tempDirectory: "/Users/test/Library/Application Support/dsh/tmp",
    logPath: "/Users/test/Library/Application Support/dsh/service.log",
  });
  assert(plist.includes("<string>127.0.0.1</string>"), "the loopback host is missing");
  assert(plist.includes("<string>3080</string>"), "the official web port is missing");
  assert(plist.includes("<key>KeepAlive</key>"), "KeepAlive is missing");
  assert(plist.includes("<key>RunAtLoad</key>"), "RunAtLoad is missing");
  assert(
    plist.includes("<string>/Users/test/Library/Application Support/dsh/tmp</string>"),
    "the isolated temporary directory is missing",
  );
  assert(plist.includes("&" + "amp;"), "XML values are not escaped");
});

Deno.test("local service extracts the latest authenticated DSH URL", () => {
  const log = [
    "dsh web: http://127.0.0.1:3080/?token=old-token",
    "dsh web: http://127.0.0.1:3080/?token=new-token",
  ].join("\n");
  assertEquals(
    parseAuthenticatedUrl(log),
    "http://127.0.0.1:3080/?token=new-token",
  );
});

Deno.test("local service paths remain inside the application support directory", () => {
  const home = "/Users/test";
  const paths = resolveLocalServicePaths(home);
  assert(paths.base.includes("DSH Intel/local-service"), "unexpected local service base");
  assert(
    paths.launchAgentPath.endsWith("com.innocces.dsh-mac-intel.service.plist"),
    "unexpected plist path",
  );
  assert(paths.dshHome.startsWith(paths.base), "DSH home escaped the local service directory");
  assert(
    paths.tempDirectory.startsWith(paths.base),
    "temporary files escaped the local service directory",
  );
  assert(
    paths.cleanupLaunchAgentPath.endsWith("com.innocces.dsh-mac-intel.cleanup.plist"),
    "unexpected cleanup plist path",
  );
});

Deno.test("local service cleanup LaunchAgent runs periodically", () => {
  const plist = buildCleanupLaunchAgentPlist({
    label: "com.example.dsh.cleanup",
    nodePath: "/Users/test/node/bin/node",
    scriptPath: "/Users/test/cleanup-storage.mjs",
    logPath: "/Users/test/cleanup.log",
    intervalSeconds: 300,
  });
  assert(plist.includes("<key>StartInterval</key>"), "cleanup interval is missing");
  assert(plist.includes("<integer>300</integer>"), "cleanup interval is incorrect");
  assert(plist.includes("<key>KeepAlive</key>"), "cleanup KeepAlive policy is missing");
});

Deno.test("local service cleanup removes stale updates and enforces the temp quota", async () => {
  const root = await Deno.makeTempDir({ prefix: "dsh-local-cleanup-test-" });
  try {
    const tempDirectory = `${root}/tmp`;
    const dshHome = `${root}/home`;
    await Deno.mkdir(tempDirectory, { recursive: true });
    await Deno.mkdir(`${dshHome}/our-free-model/upgrade-stage`, { recursive: true });
    await Deno.mkdir(`${dshHome}/our-free-model/subscriptions`, { recursive: true });
    await Deno.writeTextFile(`${tempDirectory}/stale.part`, "x".repeat(4096));
    await Deno.writeTextFile(`${dshHome}/our-free-model/upgrade-stage/partial`, "partial");
    await Deno.writeTextFile(`${dshHome}/our-free-model/subscriptions/keep`, "keep");
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await Deno.utime(`${tempDirectory}/stale.part`, old, old);
    await Deno.utime(`${dshHome}/our-free-model/upgrade-stage`, old, old);
    await Deno.utime(`${dshHome}/our-free-model/upgrade-stage/partial`, old, old);

    const result = await cleanupLocalServiceStorage({
      tempDirectory,
      dshHome,
      maxBytes: 1024,
      staleAfterMs: 24 * 60 * 60 * 1000,
      activeGraceMs: 10 * 60 * 1000,
    });
    assert(result.removedEntries >= 2, "stale update artifacts were not removed");
    assert(result.remainingBytes <= 1024, "the temporary-file quota was not enforced");
    assert(
      !(await exists(`${dshHome}/our-free-model/upgrade-stage`)),
      "the stale upgrade stage survived cleanup",
    );
    assert(
      await exists(`${dshHome}/our-free-model/subscriptions/keep`),
      "cleanup removed unrelated plugin data",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("local service cleanup script includes bounded update cleanup", () => {
  const script = buildStorageCleanupScript({
    tempDirectory: "/Users/test/tmp",
    dshHome: "/Users/test/home",
    maxBytes: 1024,
    staleAfterMs: 1000,
    activeGraceMs: 500,
  });
  assert(script.includes("maxBytes"), "the cleanup quota is missing");
  assert(script.includes("upgrade-stage"), "stale update cleanup is missing");
  assert(script.includes("remainingBytes"), "cleanup accounting is missing");
});

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}
