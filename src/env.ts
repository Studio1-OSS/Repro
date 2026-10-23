import "server-only";
import { z } from "zod";

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v : undefined));

const schema = z.object({
  NEBIUS_API_KEY: optional,
  NEBIUS_BASE_URL: z.string().url().default("https://api.tokenfactory.us-north1.nebius.com/v1/"),
  NEBIUS_MODEL: z.string().default("MiniMaxAI/MiniMax-M3.1-Flash"),
  /** Send recordings as one video_url part instead of frames. Off: Token Factory doesn't accept video for this model yet (pnpm smoke:nebius checks). */
  AI_VIDEO_INPUT: z.enum(["0", "1"]).default("0"),
  DATABASE_URL: z.string().default("file:local.db"),
  DATABASE_AUTH_TOKEN: optional,
  BETTER_AUTH_SECRET: optional,
  BETTER_AUTH_URL: optional,
  /** cloudinary://<key>:<secret>@<cloud>. Unset: uploads are stored on local disk in .uploads/ (development only). */
  CLOUDINARY_URL: optional,
  /** Daily AI credits per account: an analysis costs 2, each agent step 1. */
  AI_CREDITS_PER_USER_PER_DAY: z.coerce.number().int().min(0).default(200),
});

// Vercel preview deployments get a new URL each time: fall back to it when BETTER_AUTH_URL isn't set.
const vercelPreviewUrl =
  process.env.VERCEL_ENV === "preview" && (process.env.VERCEL_BRANCH_URL || process.env.VERCEL_URL)
    ? `https://${process.env.VERCEL_BRANCH_URL || process.env.VERCEL_URL}`
    : undefined;

export const env = schema.parse({ ...process.env, BETTER_AUTH_URL: process.env.BETTER_AUTH_URL || vercelPreviewUrl });

const isProdRuntime = process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build";

/** Settings production can't run safely without. Development warns instead. */
function requireInProd(ok: boolean, msg: string) {
  if (ok) return;
  if (isProdRuntime) throw new Error(msg);
  console.warn(`⚠ ${msg}`);
}

if (process.env.NODE_ENV === "production") {
  requireInProd((env.BETTER_AUTH_SECRET?.length ?? 0) >= 32, "BETTER_AUTH_SECRET must be set to a random value of 32+ characters (openssl rand -base64 32).");
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(env.BETTER_AUTH_URL ?? "");
  requireInProd(local || Boolean(env.BETTER_AUTH_URL?.startsWith("https://")), "BETTER_AUTH_URL must be your public https:// URL.");
  // A server with a disk (a VPS, your own machine) can keep SQLite and uploads locally; serverless hosting can't.
  if (process.env.VERCEL) {
    requireInProd(!env.DATABASE_URL.startsWith("file:"), "DATABASE_URL must point at Turso (libsql://…) on Vercel; serverless disks are not persistent.");
    requireInProd(Boolean(env.CLOUDINARY_URL), "CLOUDINARY_URL is required on Vercel; serverless disks are not persistent.");
  }
}

export const features = {
  ai: Boolean(env.NEBIUS_API_KEY),
  cloudinary: Boolean(env.CLOUDINARY_URL),
  /** Local folders, applying fixes to disk and the sandbox need Repro running on your own machine or server. */
  selfHosted: !process.env.VERCEL,
};
