import { DSH_PACKAGE, OFM_PACKAGE } from "./types.ts";

const REGISTRY_ORIGIN = "https://registry.npmjs.org";
const REQUEST_TIMEOUT_MS = 12_000;

/** Metadata fields needed from the npm registry. */
interface RegistryMetadata {
  "dist-tags"?: {
    latest?: string;
  };
  versions?: Record<string, unknown>;
}

/** Read the current `latest` dist-tag for an npm package. */
export async function fetchLatestVersion(packageName: string): Promise<string> {
  const encodedName = encodeURIComponent(packageName);
  const response = await fetchWithTimeout(`${REGISTRY_ORIGIN}/${encodedName}`, {
    headers: {
      accept: "application/vnd.npm.install-v1+json, application/json",
      "user-agent": "dsh-mac-intel/0.1.0",
    },
  });
  if (!response.ok) {
    throw new Error(`npm registry returned ${response.status} for ${packageName}`);
  }
  const metadata = await response.json() as RegistryMetadata;
  const latest = metadata["dist-tags"]?.latest;
  if (typeof latest !== "string" || !latest) {
    throw new Error(`npm registry did not return a latest version for ${packageName}`);
  }
  return latest;
}

/** Read latest versions for the two components exposed in the update center. */
export async function fetchComponentVersions(): Promise<{ harness: string; plugin: string }> {
  const [harness, plugin] = await Promise.all([
    fetchLatestVersion(DSH_PACKAGE),
    fetchLatestVersion(OFM_PACKAGE),
  ]);
  return { harness, plugin };
}

/**
 * Compare two npm versions.
 *
 * Numeric release identifiers are compared first; a stable release is newer
 * than a prerelease with the same numeric identifiers. This intentionally
 * supports the small subset used by the DSH and OFM release channels.
 */
export function compareVersions(left: string, right: string): number {
  const parse = (version: string): { core: number[]; prerelease: string[] } => {
    const [coreText = "", prereleaseText = ""] = version.replace(/^v/, "").split("-", 2);
    const core = coreText.split(".").map((part) => Number.parseInt(part, 10) || 0);
    return { core, prerelease: prereleaseText ? prereleaseText.split(".") : [] };
  };
  const a = parse(left);
  const b = parse(right);
  const length = Math.max(a.core.length, b.core.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a.core[index] ?? 0) - (b.core[index] ?? 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const aPart = a.prerelease[index];
    const bPart = b.prerelease[index];
    if (aPart === undefined) return -1;
    if (bPart === undefined) return 1;
    const aNumeric = /^\d+$/.test(aPart);
    const bNumeric = /^\d+$/.test(bPart);
    if (aNumeric && bNumeric) {
      const difference = Number(aPart) - Number(bPart);
      if (difference !== 0) return difference < 0 ? -1 : 1;
    } else if (aNumeric !== bNumeric) {
      return aNumeric ? -1 : 1;
    } else if (aPart !== bPart) {
      return aPart < bPart ? -1 : 1;
    }
  }
  return 0;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
