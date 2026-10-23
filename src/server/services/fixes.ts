import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { FixProposal } from "../ai/fix";
import { db, schema } from "../db";
import type { SandboxReport } from "../sandbox/check";

export type Fix = Omit<typeof schema.fixes.$inferSelect, "sandbox"> & { sandbox: SandboxReport | null };

export async function createFix(reportId: string, userId: string, projectId: string, p: FixProposal): Promise<Fix> {
  const [row] = await db
    .insert(schema.fixes)
    .values({
      id: nanoid(12),
      reportId,
      userId,
      projectId,
      explanation: p.explanation,
      edits: p.edits,
      diff: p.diff,
      testHint: p.testHint,
      filesRead: p.filesRead.length,
      wholeRepo: p.wholeRepo,
      inputTokens: p.usage.input,
      outputTokens: p.usage.output,
    })
    .returning();
  return row as Fix;
}

export async function getFix(id: string, userId: string): Promise<Fix | null> {
  return ((await db.query.fixes.findFirst({ where: and(eq(schema.fixes.id, id), eq(schema.fixes.userId, userId)) })) as Fix | undefined) ?? null;
}

export async function listFixes(reportId: string, userId: string): Promise<Fix[]> {
  return (await db.query.fixes.findMany({ where: and(eq(schema.fixes.reportId, reportId), eq(schema.fixes.userId, userId)), orderBy: desc(schema.fixes.createdAt) })) as Fix[];
}

export async function updateFix(id: string, fields: Partial<Pick<Fix, "status" | "sandbox" | "prUrl">>) {
  await db.update(schema.fixes).set(fields).where(eq(schema.fixes.id, id));
}
