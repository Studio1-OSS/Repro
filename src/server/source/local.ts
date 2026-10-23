// A source folder on the machine running Repro (self-hosted only).
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { IGNORED_DIR, isSourceFile, type Source, type SourceFile } from "./index";

/** Resolves a repo-relative path inside `root`, refusing anything that escapes it. */
export function safeJoin(root: string, path: string): string {
  const full = resolve(root, path);
  if (full !== root && !full.startsWith(root.endsWith(sep) ? root : root + sep)) throw new Error(`Path outside the project: ${path}`);
  return full;
}

export function localSource(dir: string): Source & { root: string; write(path: string, content: string): Promise<void> } {
  const root = resolve(dir);
  return {
    root,
    label: `local: ${root}`,
    async list() {
      const out: SourceFile[] = [];
      const entries = await readdir(root, { recursive: true, withFileTypes: true });
      for (const e of entries) {
        if (!e.isFile()) continue;
        const path = relative(root, join(e.parentPath, e.name)).split(sep).join("/");
        if (IGNORED_DIR.test(path)) continue;
        const { size } = await stat(join(root, path));
        if (isSourceFile(path, size)) out.push({ path, size });
        if (out.length >= 5000) break;
      }
      return out.sort((a, b) => a.path.localeCompare(b.path));
    },
    read: async (path) => readFile(safeJoin(root, path), "utf8"),
    write: async (path, content) => writeFile(safeJoin(root, path), content),
  };
}
