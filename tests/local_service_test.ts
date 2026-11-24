import {
  buildLaunchAgentPlist,
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
    logPath: "/Users/test/Library/Application Support/dsh/service.log",
  });
  assert(plist.includes("<string>127.0.0.1</string>"), "the loopback host is missing");
  assert(plist.includes("<string>3080</string>"), "the official web port is missing");
  assert(plist.includes("<key>KeepAlive</key>"), "KeepAlive is missing");
  assert(plist.includes("<key>RunAtLoad</key>"), "RunAtLoad is missing");
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
});
