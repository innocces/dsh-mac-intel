import { join } from "node:path";

interface PluginLock {
  package: string;
  version: string;
  integrity: string;
  sha1: string;
  tarball: string;
}

/** Download and verify the default plugin tarball included in service releases. */
async function main(): Promise<void> {
  const root = new URL("../", import.meta.url).pathname;
  const lock = JSON.parse(
    await Deno.readTextFile(join(root, "service/plugins.lock.json")),
  ) as PluginLock;
  const response = await fetch(lock.tarball, {
    headers: { "user-agent": "dsh-mac-intel-release/0.1.0" },
  });
  if (!response.ok) throw new Error(`Plugin download failed with HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());

  const digest = await crypto.subtle.digest("SHA-512", bytes);
  const integrity = `sha512-${encodeBase64(new Uint8Array(digest))}`;
  if (integrity !== lock.integrity) {
    throw new Error(`Plugin integrity mismatch: expected ${lock.integrity}, got ${integrity}`);
  }

  const outputDirectory = join(root, "service/plugins");
  await Deno.mkdir(outputDirectory, { recursive: true });
  const fileName = `${lock.package.split("/").at(-1)}-${lock.version}.tgz`;
  const outputPath = join(outputDirectory, fileName);
  await Deno.writeFile(outputPath, bytes);
  await Deno.writeTextFile(
    join(outputDirectory, "SHA512SUMS"),
    `${integrity}  ${fileName}\n`,
  );
  console.log(`Prepared verified plugin bundle: ${outputPath}`);
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

if (import.meta.main) {
  await main();
}
