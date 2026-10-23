import "server-only";
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { Message } from "../ai/nebius";
import { db, schema } from "../db";

export type Run = Omit<typeof schema.agentRuns.$inferSelect, "history"> & { history: Message[] };
export type RunEvent = typeof schema.agentEvents.$inferSelect;

export async function createRun(reportId: string, userId: string, history: Message[], purpose: Run["purpose"] = "reproduce"): Promise<Run> {
  const [row] = await db.insert(schema.agentRuns).values({ id: nanoid(12), reportId, userId, history, purpose }).returning();
  return row as Run;
}

/** A run the extension stopped driving (window closed, browser quit) would say "running" forever. */
const STALE_MS = 5 * 60_000;
async function expireIfStale<T extends { id: string; status: string; updatedAt: Date; summary: string | null }>(run: T): Promise<T> {
  if (run.status !== "running" || Date.now() - run.updatedAt.getTime() < STALE_MS) return run;
  const summary = "The browser stopped responding (window closed or extension reloaded).";
  await db.update(schema.agentRuns).set({ status: "stopped", summary }).where(and(eq(schema.agentRuns.id, run.id), eq(schema.agentRuns.status, "running")));
  return { ...run, status: "stopped", summary };
}

export async function getRun(id: string, userId: string): Promise<Run | null> {
  const row = await db.query.agentRuns.findFirst({ where: and(eq(schema.agentRuns.id, id), eq(schema.agentRuns.userId, userId)) });
  return row ? ((await expireIfStale(row)) as Run) : null;
}

export async function listRuns(reportId: string, userId: string) {
  const rows = await db.query.agentRuns.findMany({
    where: and(eq(schema.agentRuns.reportId, reportId), eq(schema.agentRuns.userId, userId)),
    orderBy: desc(schema.agentRuns.createdAt),
    columns: { history: false },
    limit: 10,
  });
  return Promise.all(rows.map(expireIfStale));
}

export async function updateRun(id: string, fields: Partial<Pick<Run, "history" | "status" | "reproduced" | "summary" | "steps" | "inputTokens" | "outputTokens">>) {
  await db.update(schema.agentRuns).set(fields).where(eq(schema.agentRuns.id, id));
}

/** Appends an event with the next sequence number. */
export async function addEvent(runId: string, kind: RunEvent["kind"], payload: unknown, screenshotUrl?: string) {
  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${schema.agentEvents.seq}), 0) + 1` })
    .from(schema.agentEvents)
    .where(eq(schema.agentEvents.runId, runId));
  await db.insert(schema.agentEvents).values({ runId, seq: next, kind, payload, screenshotUrl });
}

export async function eventsAfter(runId: string, seq: number): Promise<RunEvent[]> {
  return db.query.agentEvents.findMany({
    where: and(eq(schema.agentEvents.runId, runId), gt(schema.agentEvents.seq, seq)),
    orderBy: asc(schema.agentEvents.seq),
  });
}
