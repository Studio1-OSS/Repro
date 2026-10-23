// A GitHub repository through the REST API. Public repos work without a token; a fine-grained token with
// "Contents: read and write" and "Pull requests: read and write" is needed for private repos and PRs.
import { isSourceFile, type Source } from "./index";

export type GithubRepo = { repo: string; branch: string; token?: string };
type Fetch = typeof fetch;

export type PullRequest = { title: string; body: string; branch: string; files: { path: string; content: string }[] };

export function githubSource(cfg: GithubRepo, fetchImpl: Fetch = fetch): Source & { openPullRequest: (pr: PullRequest) => Promise<string> } {
  const gh = (path: string, init: RequestInit = {}, accept = "application/vnd.github+json") =>
    fetchImpl(`https://api.github.com${path}`, {
      ...init,
      headers: { accept, "x-github-api-version": "2022-11-28", ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {}), ...(init.headers ?? {}) },
    });
  return {
    label: `github: ${cfg.repo}@${cfg.branch}`,
    async list() {
      const res = await gh(`/repos/${cfg.repo}/git/trees/${encodeURIComponent(cfg.branch)}?recursive=1`);
      if (!res.ok) throw new Error(`GitHub: couldn't list ${cfg.repo}@${cfg.branch} (${res.status})`);
      const body = (await res.json()) as { tree: { path: string; type: string; size?: number }[] };
      return body.tree.filter((t) => t.type === "blob" && isSourceFile(t.path, t.size ?? 0)).map((t) => ({ path: t.path, size: t.size ?? 0 }));
    },
    async read(path) {
      const res = await gh(`/repos/${cfg.repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(cfg.branch)}`, {}, "application/vnd.github.raw");
      if (!res.ok) throw new Error(`GitHub: couldn't read ${path} (${res.status})`);
      return res.text();
    },
    openPullRequest: (pr) => openPullRequest(cfg, pr, fetchImpl),
  };
}

/** Commits the changed files to a new branch and opens a pull request. Returns its URL. */
export async function openPullRequest(
  cfg: GithubRepo,
  pr: PullRequest,
  fetchImpl: Fetch = fetch,
): Promise<string> {
  if (!cfg.token) throw new Error("Opening a pull request needs a GitHub token on the project.");
  const call = async (path: string, init: RequestInit = {}) => {
    const res = await fetchImpl(`https://api.github.com${path}`, {
      ...init,
      headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`GitHub ${init.method ?? "GET"} ${path.split("?")[0]} failed (${res.status}): ${(body as { message?: string }).message ?? ""}`);
    return body as Record<string, unknown>;
  };
  const base = (await call(`/repos/${cfg.repo}/git/ref/heads/${encodeURIComponent(cfg.branch)}`)) as { object: { sha: string } };
  await call(`/repos/${cfg.repo}/git/refs`, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${pr.branch}`, sha: base.object.sha }) });
  for (const f of pr.files) {
    const path = f.path.split("/").map(encodeURIComponent).join("/");
    const existing = (await call(`/repos/${cfg.repo}/contents/${path}?ref=${encodeURIComponent(pr.branch)}`).catch(() => null)) as { sha?: string } | null;
    await call(`/repos/${cfg.repo}/contents/${path}`, {
      method: "PUT",
      body: JSON.stringify({ message: `fix: ${pr.title}`.slice(0, 72), content: Buffer.from(f.content).toString("base64"), branch: pr.branch, ...(existing?.sha ? { sha: existing.sha } : {}) }),
    });
  }
  const created = (await call(`/repos/${cfg.repo}/pulls`, { method: "POST", body: JSON.stringify({ title: pr.title, body: pr.body, head: pr.branch, base: cfg.branch }) })) as { html_url: string };
  return created.html_url;
}

/** Downloads the repository at the branch as a tarball (for the sandbox). */
export async function downloadTarball(cfg: GithubRepo, fetchImpl: Fetch = fetch): Promise<Buffer> {
  const res = await fetchImpl(`https://api.github.com/repos/${cfg.repo}/tarball/${encodeURIComponent(cfg.branch)}`, {
    headers: { accept: "application/vnd.github+json", ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {}) },
  });
  if (!res.ok) throw new Error(`GitHub: couldn't download ${cfg.repo}@${cfg.branch} (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}
