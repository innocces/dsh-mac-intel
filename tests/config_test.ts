import {
  cleanHost,
  cleanServicePath,
  cleanUrl,
  defaultConfig,
  normalizeConfig,
  normalizeShortcut,
} from "../src/config.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEquals<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test("default config keeps the built-in plugin shortcuts", () => {
  const config = defaultConfig();
  assert(
    config.shortcuts.some((shortcut) => shortcut.target === "@ebony-vinyl/dsh-our-free-model"),
    "OFM shortcut missing",
  );
  assert(
    config.shortcuts.some((shortcut) => shortcut.id === "plugin-update"),
    "plugin update shortcut missing",
  );
});

Deno.test("normalization rejects unsafe hosts, URLs, and service paths", () => {
  assertEquals(cleanHost("example.com"), "example.com");
  assertEquals(cleanHost("-oProxyCommand=evil"), "");
  assertEquals(cleanHost("host;rm -rf /"), "");
  assertEquals(cleanUrl("javascript:alert(1)"), "");
  assertEquals(cleanUrl("https://user:secret@example.com"), "");
  assertEquals(
    cleanServicePath("~/.local/share/dsh-mac-intel/bin/dsh-mac-intel-service"),
    "~/.local/share/dsh-mac-intel/bin/dsh-mac-intel-service",
  );
  assertEquals(
    cleanServicePath("$(whoami)"),
    "~/.local/share/dsh-mac-intel/bin/dsh-mac-intel-service",
  );
});

Deno.test("unknown config fields cannot replace the schema version", () => {
  const config = normalizeConfig({ schemaVersion: 99, activeProfileId: "missing" });
  assertEquals(config.schemaVersion, 1);
  assertEquals(config.activeProfileId, config.profiles[0].id);
});

Deno.test("shortcut normalization requires a label and a URL for URL shortcuts", () => {
  assertEquals(normalizeShortcut({ id: "one", label: "One", kind: "url", url: "" }), null);
  const shortcut = normalizeShortcut({
    id: "one",
    label: "One",
    kind: "url",
    url: "https://example.com/path",
    matchText: ["Example"],
  });
  if (shortcut === null) throw new Error("valid shortcut was rejected");
  assertEquals(shortcut.kind, "url");
});
