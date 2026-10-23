import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { env } from "@/env";
import { decrypt, encrypt } from "../crypto";
import { db, schema } from "../db";
import type { SandboxTarget } from "../sandbox/check";
import { downloadTarball, githubSource } from "../source/github";
import { localSource } from "../source/local";

export type Project = typeof schema.projects.$inferSelect;

const secret = () => env.BETTER_AUTH_SECRET ?? "repro-dev-secret";
const blank = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

export const projectInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  origins: z.array(z.string().url()).min(1).max(10),
  sourceType: z.enum(["local", "github"]),
  localPath: z.string().max(500).optional(),
  githubRepo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, "owner/repo").optional().or(z.literal("")),
  githubBranch: z.string().max(100).optional(),
  /** Empty keeps the stored token; "-" clears it. */
  githubToken: z.string().max(400).optional(),
  checkCommand: z.string().max(300).optional(),
  startCommand: z.string().max(300).optional(),
  appPort: z.coerce.number().int().min(1).max(65535).optional().or(z.literal("")),
  signInPath: z.string().max(200).optional(),
  signInEmail: z.string().max(200).optional(),
  signInPassword: z.string().max(200).optional(),
  webhookUrl: z.string().url().optional().or(z.literal("")),
});
export type ProjectInput = z.infer<typeof projectInputSchema>;

const sealed = (next: string | undefined, current: string | null) => (next === "-" ? null : next ? encrypt(next, secret()) : current);

function values(input: ProjectInput, current?: Project) {
  return {
    name: input.name,
    origins: input.origins.map((o) => new URL(o).origin),
    sourceType: input.sourceType,
    localPath: blank(input.localPath),
    githubRepo: blank(input.githubRepo),
    githubBranch: blank(input.githubBranch) ?? "main",
    githubToken: sealed(input.githubToken, current?.githubToken ?? null),
    checkCommand: blank(input.checkCommand),
    startCommand: blank(input.startCommand),
    appPort: typeof input.appPort === "number" ? input.appPort : null,
    signInPath: blank(input.signInPath),
    signInEmail: blank(input.signInEmail),
    signInPassword: sealed(input.signInPassword, current?.signInPassword ?? null),
    webhookUrl: blank(input.webhookUrl),
  };
}

export async function listProjects(userId: string) {
  return db.query.projects.findMany({ where: eq(schema.projects.userId, userId), orderBy: desc(schema.projects.createdAt) });
}

export async function getProject(id: string, userId: string) {
  return (await db.query.projects.findFirst({ where: and(eq(schema.projects.id, id), eq(schema.projects.userId, userId)) })) ?? null;
}

export async function saveProject(userId: string, input: ProjectInput, id?: string): Promise<Project> {
  if (id) {
    const current = await getProject(id, userId);
    if (!current) throw new Error("Project not found");
    const [row] = await db.update(schema.projects).set(values(input, current)).where(eq(schema.projects.id, id)).returning();
    return row;
  }
  const [row] = await db.insert(schema.projects).values({ id: nanoid(12), userId, ...values(input) }).returning();
  return row;
}

export async function deleteProject(id: string, userId: string) {
  await db.delete(schema.projects).where(and(eq(schema.projects.id, id), eq(schema.projects.userId, userId)));
}

/** The project a page belongs to, by its origin. */
export async function projectForUrl(userId: string, pageUrl: string): Promise<Project | null> {
  const origin = new URL(pageUrl).origin;
  return (await listProjects(userId)).find((p) => p.origins.includes(origin)) ?? null;
}

/** What the browser may see: no secrets, just whether they're set. */
export const publicProject = (p: Project) => ({ ...p, githubToken: Boolean(p.githubToken), signInPassword: Boolean(p.signInPassword) });

const githubConfig = (p: Project) => ({ repo: p.githubRepo!, branch: p.githubBranch ?? "main", token: p.githubToken ? decrypt(p.githubToken, secret()) : undefined });

export function sourceFor(p: Project) {
  if (p.sourceType === "local") {
    if (!p.localPath) throw new Error("Set the project's local folder.");
    return localSource(p.localPath);
  }
  if (!p.githubRepo) throw new Error("Set the project's GitHub repository.");
  return githubSource(githubConfig(p));
}

export async function sandboxTargetFor(p: Project, pageUrl: string): Promise<SandboxTarget> {
  const u = new URL(pageUrl);
  return {
    from: p.sourceType === "local" ? { dir: p.localPath! } : { tarball: await downloadTarball(githubConfig(p)) },
    checkCommand: p.checkCommand,
    startCommand: p.startCommand,
    appPort: p.appPort,
    startPath: u.pathname + u.search,
    signIn: p.signInPath && p.signInEmail && p.signInPassword ? { path: p.signInPath, email: p.signInEmail, password: decrypt(p.signInPassword, secret()) } : undefined,
  };
}

export async function openPullRequestFor(p: Project, pr: { title: string; body: string; branch: string; files: { path: string; content: string }[] }) {
  if (p.sourceType !== "github") throw new Error("Pull requests need a GitHub project.");
  return githubSource(githubConfig(p)).openPullRequest(pr);
}
