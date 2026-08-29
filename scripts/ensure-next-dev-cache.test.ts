import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_NEXT_DEV_CACHE_MAX_BYTES,
  ensureNextDevCache,
  getDirectorySizeBytes,
} from "./ensure-next-dev-cache";

function makeRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "next-dev-cache-"));
  for (const app of ["dashboard", "www"]) {
    fs.mkdirSync(path.join(root, "apps", app), { recursive: true });
  }
  return root;
}

function writeNextFile(repoRoot: string, app: string, relPath: string, contents: string | Buffer) {
  const file = path.join(repoRoot, "apps", app, ".next", relPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("getDirectorySizeBytes", () => {
  it("sums nested files and ignores missing directories", () => {
    const root = makeRepo();
    tmpRoots.push(root);
    writeNextFile(root, "dashboard", "a.txt", Buffer.alloc(100));
    writeNextFile(root, "dashboard", "nested/b.txt", Buffer.alloc(50));
    expect(getDirectorySizeBytes(path.join(root, "apps", "dashboard", ".next"))).toBe(150);
    expect(getDirectorySizeBytes(path.join(root, "apps", "missing", ".next"))).toBe(0);
  });
});

describe("ensureNextDevCache", () => {
  it("leaves a small healthy .next cache in place", () => {
    const root = makeRepo();
    tmpRoots.push(root);
    writeNextFile(root, "dashboard", "cache/keep.txt", "ok");
    const result = ensureNextDevCache({ repoRoot: root, maxBytes: 10_000 });
    expect(result.pruned).toEqual([]);
    expect(fs.existsSync(path.join(root, "apps", "dashboard", ".next", "cache", "keep.txt"))).toBe(
      true,
    );
  });

  it("deletes .next when it exceeds the size cap", () => {
    const root = makeRepo();
    tmpRoots.push(root);
    writeNextFile(root, "dashboard", "cache/blob.bin", Buffer.alloc(1_000));
    const logs: string[] = [];
    const result = ensureNextDevCache({
      repoRoot: root,
      maxBytes: 500,
      log: (message) => logs.push(message),
    });
    expect(result.pruned).toEqual(["dashboard"]);
    expect(fs.existsSync(path.join(root, "apps", "dashboard", ".next"))).toBe(false);
    expect(logs.join("\n")).toMatch(/dashboard/i);
    expect(logs.join("\n")).toMatch(/cap|size|exceed/i);
  });

  it("deletes .next when the Turbopack instrumentation chunk is corrupt", () => {
    const root = makeRepo();
    tmpRoots.push(root);
    writeNextFile(root, "www", "dev/server/chunks/instrumentation.js", "MODULE_UNPARSABLE");
    const result = ensureNextDevCache({
      repoRoot: root,
      maxBytes: 10_000,
      log: () => {},
    });
    expect(result.pruned).toEqual(["www"]);
    expect(fs.existsSync(path.join(root, "apps", "www", ".next"))).toBe(false);
  });

  it("defaults the size cap to 2 GiB", () => {
    expect(DEFAULT_NEXT_DEV_CACHE_MAX_BYTES).toBe(2 * 1024 * 1024 * 1024);
  });
});
