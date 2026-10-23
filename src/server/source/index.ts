// Read access to an app's source code, wherever it lives. The fix agent only sees this interface.
// No server-only imports: the bench uses it too.

export type SourceFile = { path: string; size: number };

export interface Source {
  /** Shown in the UI: "local: ~/code/shop" or "github: acme/shop@main". */
  label: string;
  /** Text files the agent may read, without dependencies or build output. */
  list(): Promise<SourceFile[]>;
  read(path: string): Promise<string>;
}

/** Folders never worth reading: dependencies, VCS, build output, caches. */
export const IGNORED_DIR = /(^|\/)(node_modules|\.git|\.next|\.nuxt|\.svelte-kit|dist|build|out|coverage|\.turbo|\.vercel|\.cache|vendor|\.output|\.wxt|__pycache__|\.venv)(\/|$)/;
const TEXT_FILE = /\.(m?[jt]sx?|cjs|json|css|scss|sass|less|html?|vue|svelte|astro|mdx?|ya?ml|toml|py|rb|go|rs|java|kt|php|cs|swift|sql|graphql|gql|sh|prisma)$/i;
const LOCKFILE = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|poetry\.lock)$/;
export const MAX_FILE_BYTES = 200_000;

export const isSourceFile = (path: string, size: number) => TEXT_FILE.test(path) && !IGNORED_DIR.test(path) && !LOCKFILE.test(path) && size <= MAX_FILE_BYTES;
