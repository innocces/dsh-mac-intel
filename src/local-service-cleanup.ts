/** Bounds and roots used by the local-service storage cleaner. */
export interface StorageCleanupOptions {
  tempDirectory: string;
  dshHome: string;
  maxBytes: number;
  staleAfterMs: number;
  activeGraceMs: number;
}

/** Summary of one storage-cleanup pass. */
export interface StorageCleanupResult {
  removedEntries: number;
  removedBytes: number;
  remainingBytes: number;
}

/** Build the Node.js cleaner executed periodically by launchd. */
export function buildStorageCleanupScript(options: StorageCleanupOptions): string {
  const config = JSON.stringify({
    tempDirectory: options.tempDirectory,
    dshHome: options.dshHome,
    maxBytes: options.maxBytes,
    staleAfterMs: options.staleAfterMs,
    activeGraceMs: options.activeGraceMs,
  });
  return `import { lstat, mkdir, readdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";

const config = ${config};
const now = Date.now();

async function usage(path) {
  let info;
  try { info = await lstat(path); } catch { return { bytes: 0, mtimeMs: 0 }; }
  if (!info.isDirectory() || info.isSymbolicLink()) return { bytes: info.size, mtimeMs: info.mtimeMs };
  let bytes = 0;
  let mtimeMs = info.mtimeMs;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = await usage(join(path, entry.name));
    bytes += child.bytes;
    mtimeMs = Math.max(mtimeMs, child.mtimeMs);
  }
  return { bytes, mtimeMs };
}

async function removeIfStale(path, staleBefore) {
  try {
    const info = await lstat(path);
    if (info.mtimeMs >= staleBefore) return false;
    await rm(path, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

async function removeMatching(root, predicate, staleBefore) {
  let removed = 0;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try { entries = await readdir(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const child = join(current, entry.name);
      if (predicate(basename(child)) && await removeIfStale(child, staleBefore)) {
        removed += 1;
      } else if (entry.isDirectory() && !entry.isSymbolicLink()) {
        stack.push(child);
      }
    }
  }
  return removed;
}

async function cleanup() {
  await mkdir(config.tempDirectory, { recursive: true, mode: 0o700 });
  const staleBefore = now - config.staleAfterMs;
  const activeBefore = now - config.activeGraceMs;
  let removedEntries = 0;
  let removedBytes = 0;

  const pluginData = join(config.dshHome, "our-free-model");
  removedEntries += await removeMatching(
    pluginData,
    (name) =>
      name === "upgrade-stage" ||
      name.startsWith("rollback.pending-") ||
      name.startsWith("rollback.previous-") ||
      name.endsWith(".tmp"),
    staleBefore,
  );
  removedEntries += await removeMatching(
    join(config.dshHome, "profiles", "web", "node_modules", "dsh-our-free-model"),
    (name) => name.endsWith(".ofm-new") || name.endsWith(".ofm-old"),
    staleBefore,
  );

  const entries = await readdir(config.tempDirectory, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    const path = join(config.tempDirectory, entry.name);
    const stats = await usage(path);
    candidates.push({ path, bytes: stats.bytes, mtimeMs: stats.mtimeMs });
  }
  candidates.sort((left, right) => left.mtimeMs - right.mtimeMs);
  let remainingBytes = candidates.reduce((sum, entry) => sum + entry.bytes, 0);
  for (const candidate of candidates) {
    if (candidate.mtimeMs >= staleBefore) continue;
    const before = candidate.bytes;
    await rm(candidate.path, { recursive: true, force: true });
    removedEntries += 1;
    removedBytes += before;
    remainingBytes -= before;
  }
  for (const candidate of candidates) {
    if (remainingBytes <= config.maxBytes) break;
    if (candidate.mtimeMs >= activeBefore || candidate.mtimeMs < staleBefore) continue;
    const before = candidate.bytes;
    await rm(candidate.path, { recursive: true, force: true });
    removedEntries += 1;
    removedBytes += before;
    remainingBytes -= before;
  }

  const result = { removedEntries, removedBytes, remainingBytes };
  console.log(JSON.stringify(result));
  return result;
}

cleanup().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
`;
}

/** Remove stale update artifacts and enforce the isolated temporary-file quota. */
export async function cleanupLocalServiceStorage(
  options: StorageCleanupOptions,
): Promise<StorageCleanupResult> {
  await Deno.mkdir(options.tempDirectory, { recursive: true, mode: 0o700 });
  const now = Date.now();
  const staleBefore = now - options.staleAfterMs;
  const activeBefore = now - options.activeGraceMs;
  let removedEntries = 0;
  let removedBytes = 0;

  const pluginData = `${options.dshHome}/our-free-model`;
  removedEntries += await removeMatchingStale(
    pluginData,
    (name) =>
      name === "upgrade-stage" ||
      name.startsWith("rollback.pending-") ||
      name.startsWith("rollback.previous-") ||
      name.endsWith(".tmp"),
    staleBefore,
  );
  removedEntries += await removeMatchingStale(
    `${options.dshHome}/profiles/web/node_modules/dsh-our-free-model`,
    (name) => name.endsWith(".ofm-new") || name.endsWith(".ofm-old"),
    staleBefore,
  );

  const candidates: StorageEntry[] = [];
  for await (const entry of Deno.readDir(options.tempDirectory)) {
    const path = `${options.tempDirectory}/${entry.name}`;
    const stats = await storageUsage(path);
    candidates.push({ path, ...stats });
  }
  candidates.sort((left, right) => left.mtimeMs - right.mtimeMs);
  let remainingBytes = candidates.reduce((sum, entry) => sum + entry.bytes, 0);
  for (const candidate of candidates) {
    if (candidate.mtimeMs >= staleBefore) continue;
    await Deno.remove(candidate.path, { recursive: true }).catch(() => undefined);
    removedEntries += 1;
    removedBytes += candidate.bytes;
    remainingBytes -= candidate.bytes;
  }
  for (const candidate of candidates) {
    if (remainingBytes <= options.maxBytes) break;
    if (candidate.mtimeMs >= activeBefore || candidate.mtimeMs < staleBefore) continue;
    await Deno.remove(candidate.path, { recursive: true }).catch(() => undefined);
    removedEntries += 1;
    removedBytes += candidate.bytes;
    remainingBytes -= candidate.bytes;
  }
  return { removedEntries, removedBytes, remainingBytes };
}

interface StorageEntry {
  path: string;
  bytes: number;
  mtimeMs: number;
}

async function storageUsage(path: string): Promise<{ bytes: number; mtimeMs: number }> {
  let info: Deno.FileInfo;
  try {
    info = await Deno.lstat(path);
  } catch {
    return { bytes: 0, mtimeMs: 0 };
  }
  if (!info.isDirectory || info.isSymlink) {
    return { bytes: info.size, mtimeMs: info.mtime?.getTime() ?? 0 };
  }
  let bytes = 0;
  let mtimeMs = info.mtime?.getTime() ?? 0;
  for await (const entry of Deno.readDir(path)) {
    const child = await storageUsage(`${path}/${entry.name}`);
    bytes += child.bytes;
    mtimeMs = Math.max(mtimeMs, child.mtimeMs);
  }
  return { bytes, mtimeMs };
}

async function removeMatchingStale(
  root: string,
  matches: (name: string) => boolean,
  staleBefore: number,
): Promise<number> {
  let removed = 0;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: Deno.DirEntry[];
    try {
      entries = await Array.fromAsync(Deno.readDir(current));
    } catch {
      continue;
    }
    for (const entry of entries) {
      const child = `${current}/${entry.name}`;
      if (entry.isDirectory && !entry.isSymlink) {
        let info: Deno.FileInfo;
        try {
          info = await Deno.lstat(child);
        } catch {
          continue;
        }
        if (matches(entry.name) && (info.mtime?.getTime() ?? 0) < staleBefore) {
          await Deno.remove(child, { recursive: true }).catch(() => undefined);
          removed += 1;
        } else {
          stack.push(child);
        }
      } else if (matches(entry.name)) {
        let info: Deno.FileInfo;
        try {
          info = await Deno.lstat(child);
        } catch {
          continue;
        }
        if ((info.mtime?.getTime() ?? 0) < staleBefore) {
          await Deno.remove(child, { recursive: true }).catch(() => undefined);
          removed += 1;
        }
      }
    }
  }
  return removed;
}
