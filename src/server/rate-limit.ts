import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "./db";

/** What each AI call costs, in daily credits. An analysis reads the whole recording; an agent step is one small turn; a fix reads the codebase; a sandbox check runs the agent twice. */
export const AI_COSTS = { analyze: 2, agentStep: 1, fix: 6, sandbox: 4 } as const;
export type AiAction = keyof typeof AI_COSTS;

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Atomically spends `cost` credits from today's allowance for `key`.
 * If that would go over `limit`, the credits are given back and false is returned.
 */
export async function spendCredits(key: string, cost: number, limit: number): Promise<boolean> {
  const day = today();
  const [row] = await db
    .insert(schema.aiUsage)
    .values({ key, day, count: cost })
    .onConflictDoUpdate({
      target: [schema.aiUsage.key, schema.aiUsage.day],
      set: { count: sql`${schema.aiUsage.count} + ${cost}` },
    })
    .returning({ count: schema.aiUsage.count });
  if (row.count <= limit) return true;
  await db
    .update(schema.aiUsage)
    .set({ count: sql`${schema.aiUsage.count} - ${cost}` })
    .where(and(eq(schema.aiUsage.key, key), eq(schema.aiUsage.day, day)));
  return false;
}

/** Credits `key` has left today (for the meter in the UI). */
export async function creditsLeft(key: string, limit: number): Promise<number> {
  const row = await db.query.aiUsage.findFirst({ where: and(eq(schema.aiUsage.key, key), eq(schema.aiUsage.day, today())) });
  return Math.max(0, limit - (row?.count ?? 0));
}
