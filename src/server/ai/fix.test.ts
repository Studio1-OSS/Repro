import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { githubSource, openPullRequest } from "../source/github";
import { localSource, safeJoin } from "../source/local";
import { applyEdits, renderDiff } from "./fix";

describe("applyEdits", () => {
  const files = new Map([["src/a.js", "const x = 1;\nconst y = 2;\nconst x2 = 1;\n"]]);

  it("replaces a unique snippet and renders a unified diff", () => {
    const { files: out, errors } = applyEdits(files, [{ path: "src/a.js", search: "const y = 2;", replace: "const y = 3;" }]);
    expect(errors).toEqual([]);
    expect(out.get("src/a.js")).toBe("const x = 1;\nconst y = 3;\nconst x2 = 1;\n");
    const diff = renderDiff(files, out);
    expect(diff).toContain("--- a/src/a.js");
    expect(diff).toContain("-const y = 2;");
    expect(diff).toContain("+const y = 3;");
  });

  it("refuses ambiguous, missing and unknown-file edits, and creates new files", () => {
    const { files: out, errors } = applyEdits(files, [
      { path: "src/a.js", search: "= 1;", replace: "= 0;" },
      { path: "src/a.js", search: "nope", replace: "" },
      { path: "src/b.js", search: "x", replace: "y" },
      { path: "src/new.js", search: "", replace: "export {};\n" },
    ]);
    expect(errors).toEqual([
      "src/a.js: search text appears more than once; include more lines",
      "src/a.js: search text not found (copy it exactly from the file)",
      "src/b.js: no such file",
    ]);
    expect(out.get("src/new.js")).toBe("export {};\n");
  });
});

describe("localSource", () => {
  it("lists source files, skips dependencies and build output, and never leaves the folder", async () => {
    const dir = mkdtempSync(join(tmpdir(), "repro-src-"));
    mkdirSync(join(dir, "src"));
    mkdirSync(join(dir, "node_modules/x"), { recursive: true });
    mkdirSync(join(dir, "dist"));
    writeFileSync(join(dir, "src/app.ts"), "export const a = 1;\n");
    writeFileSync(join(dir, "node_modules/x/index.js"), "x");
    writeFileSync(join(dir, "dist/app.js"), "x");
    writeFileSync(join(dir, "logo.png"), "x");
    const src = localSource(dir);
    expect((await src.list()).map((f) => f.path)).toEqual(["src/app.ts"]);
    expect(await src.read("src/app.ts")).toContain("export const a");
    expect(() => safeJoin(dir, "../etc/passwd")).toThrow(/outside/);
    await expect(src.read("../../etc/passwd")).rejects.toThrow(/outside/);
  });
});

describe("githubSource", () => {
  it("lists the tree and reads raw files with the token", async () => {
    const calls: { url: string; auth?: string; accept?: string }[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      const h = init?.headers as Record<string, string>;
      calls.push({ url, auth: h.authorization, accept: h.accept });
      if (url.includes("/git/trees/")) return Response.json({ tree: [{ path: "src/a.ts", type: "blob", size: 10 }, { path: "node_modules/x.js", type: "blob", size: 1 }, { path: "src", type: "tree" }] });
      return new Response("export {};");
    }) as typeof fetch;
    const src = githubSource({ repo: "acme/shop", branch: "main", token: "t" }, fake);
    expect(await src.list()).toEqual([{ path: "src/a.ts", size: 10 }]);
    expect(await src.read("src/a.ts")).toBe("export {};");
    expect(calls[1]).toMatchObject({ url: "https://api.github.com/repos/acme/shop/contents/src/a.ts?ref=main", auth: "Bearer t", accept: "application/vnd.github.raw" });
  });

  it("opens a pull request: branch from base, one commit per file, then the PR", async () => {
    const calls: string[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url.replace("https://api.github.com", "")}`);
      if (url.endsWith("/git/ref/heads/main")) return Response.json({ object: { sha: "abc" } });
      if (url.includes("/contents/") && !init?.method) return Response.json({ sha: "old" });
      if (url.endsWith("/pulls")) return Response.json({ html_url: "https://github.com/acme/shop/pull/7" });
      return Response.json({});
    }) as typeof fetch;
    const url = await openPullRequest({ repo: "acme/shop", branch: "main", token: "t" }, { title: "Fix coupon", body: "b", branch: "repro/fix-1", files: [{ path: "src/a.ts", content: "x" }] }, fake);
    expect(url).toBe("https://github.com/acme/shop/pull/7");
    expect(calls).toEqual([
      "GET /repos/acme/shop/git/ref/heads/main",
      "POST /repos/acme/shop/git/refs",
      "GET /repos/acme/shop/contents/src/a.ts?ref=repro%2Ffix-1",
      "PUT /repos/acme/shop/contents/src/a.ts",
      "POST /repos/acme/shop/pulls",
    ]);
  });
});
