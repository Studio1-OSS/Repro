// Applies the SQL migrations in ./drizzle to DATABASE_URL (local SQLite file by default, or Turso).
import "dotenv/config";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

const url = process.env.DATABASE_URL || "file:local.db";
const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });

await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
console.log(`Migrations applied to ${url.startsWith("file:") ? url : new URL(url).host}`);
client.close();
