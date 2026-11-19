import { join } from "node:path";

/** Validate required release assets and write non-sensitive build metadata. */
async function main(): Promise<void> {
  const root = new URL("../", import.meta.url).pathname;
  const denoConfig = JSON.parse(await Deno.readTextFile(join(root, "deno.json"))) as {
    version?: string;
  };
  if (typeof denoConfig.version !== "string" || !denoConfig.version) {
    throw new Error("deno.json must contain a version");
  }

  const requiredAssets = [
    "assets/DSH-Intel.icns",
    "assets/dsh-mark.svg",
    "assets/ofm-icon.svg",
    "assets/fonts/montserrat-regular.woff2",
    "assets/fonts/montserrat-medium.woff2",
  ];
  for (const asset of requiredAssets) {
    const path = join(root, asset);
    try {
      const info = await Deno.stat(path);
      if (!info.isFile || info.size === 0) throw new Error("not a non-empty file");
    } catch {
      throw new Error(`Required release asset is missing: ${asset}`);
    }
  }

  const outputDirectory = join(root, "dist");
  await Deno.mkdir(outputDirectory, { recursive: true });
  await Deno.writeTextFile(
    join(outputDirectory, "build-info.json"),
    `${
      JSON.stringify(
        {
          name: "DSH Intel",
          version: denoConfig.version,
          target: "x86_64-apple-darwin",
          runtime: "deno-desktop",
        },
        null,
        2,
      )
    }\n`,
  );
  console.log(`Prepared DSH Intel ${denoConfig.version} build metadata`);
}

if (import.meta.main) {
  await main();
}
