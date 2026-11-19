import { compareVersions } from "../src/registry.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

Deno.test("version comparison follows npm prerelease ordering", () => {
  assert(compareVersions("0.2.2", "0.2.2-rc.5") > 0, "stable should be newer than rc");
  assert(compareVersions("0.2.2-rc.5", "0.2.2-rc.4") > 0, "newer rc should win");
  assert(compareVersions("2.8.5", "2.8.5") === 0, "equal versions should compare equal");
  assert(compareVersions("0.2.10", "0.2.9") > 0, "numeric components should compare numerically");
});
