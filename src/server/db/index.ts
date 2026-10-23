import "server-only";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { env } from "@/env";
import * as schema from "./schema";

// Reuse one client across hot reloads in dev, keyed by URL so changing DATABASE_URL takes effect.
const globalForDb = globalThis as unknown as { libsql?: { url: string; client: Client } };

function getClient(): Client {
  const cached = globalForDb.libsql;
  if (cached?.url === env.DATABASE_URL) return cached.client;
  cached?.client.close();
  const client = createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN });
  if (process.env.NODE_ENV !== "production") globalForDb.libsql = { url: env.DATABASE_URL, client };
  return client;
}

export const db = drizzle(getClient(), { schema });
export type DB = typeof db;
export { schema };

/** True when an error means the database exists but hasn't been migrated. */
export function isUnmigratedError(e: unknown): boolean {
  const msg = String((e as { message?: unknown; cause?: { message?: unknown } })?.cause?.message ?? (e as Error)?.message ?? "");
  return /no such table/i.test(msg);
}

export const UNMIGRATED_MESSAGE = "The database hasn't been set up yet. Run `pnpm db:migrate` with the same DATABASE_URL, then restart.";
