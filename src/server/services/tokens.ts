import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "../db";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** A new extension token. Only its hash is stored; the raw token is shown to the extension once. */
export async function createExtensionToken(userId: string, label: string): Promise<string> {
  const token = `rp_${randomBytes(24).toString("base64url")}`;
  await db.insert(schema.extensionTokens).values({ id: nanoid(), userId, tokenHash: hash(token), label: label.slice(0, 80) });
  return token;
}

/** The user behind an `Authorization: Bearer rp_…` header, or null. */
export async function userFromBearer(request: Request): Promise<{ id: string; name: string; email: string } | null> {
  const token = request.headers.get("authorization")?.match(/^Bearer (rp_[A-Za-z0-9_-]{20,})$/)?.[1];
  if (!token) return null;
  const row = await db.query.extensionTokens.findFirst({ where: eq(schema.extensionTokens.tokenHash, hash(token)) });
  if (!row) return null;
  const user = await db.query.user.findFirst({ where: eq(schema.user.id, row.userId) });
  if (!user) return null;
  await db.update(schema.extensionTokens).set({ lastUsedAt: new Date() }).where(eq(schema.extensionTokens.id, row.id));
  return { id: user.id, name: user.name, email: user.email };
}
