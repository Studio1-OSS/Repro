import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`)
    .$onUpdate(() => new Date()),
};

// ── Better Auth tables (field names must match Better Auth's core schema) ──────────────

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  ...timestamps,
});


export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp_ms" }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps,
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  ...timestamps,
});

// ── App tables ────────────────────────────────────────────────────────────────────────

/** One per paired browser extension. Only the SHA-256 of the token is stored. */
export const extensionTokens = sqliteTable(
  "extension_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    label: text("label").notNull(),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
    ...timestamps,
  },
  (t) => [index("extension_tokens_user_idx").on(t.userId)],
);

/** A captured bug: media in storage, logs and the AI analysis as JSON (shapes in src/shared/schemas.ts). */
export const reports = sqliteTable(
  "reports",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** What the reporter wrote when recording. */
    note: text("note"),
    pageUrl: text("page_url").notNull(),
    kind: text("kind", { enum: ["video", "screenshot", "replay", "responsive"] }).notNull(),
    videoUrl: text("video_url"),
    replayUrl: text("replay_url"),
    pageState: text("page_state", { mode: "json" }),
    breakpoints: text("breakpoints", { mode: "json" }),
    durationMs: integer("duration_ms"),
    frames: text("frames", { mode: "json" }).$type<{ t: number; url: string }[]>().notNull(),
    logs: text("logs", { mode: "json" }).notNull(),
    device: text("device", { mode: "json" }).notNull(),
    status: text("status", { enum: ["new", "analyzing", "ready", "failed"] }).notNull().default("new"),
    analysis: text("analysis", { mode: "json" }),
    analysisError: text("analysis_error"),
    /** Anyone with /s/<shareSlug> can view when shared is true. */
    shareSlug: text("share_slug").notNull().unique(),
    shared: integer("shared", { mode: "boolean" }).notNull().default(false),
    ...timestamps,
  },
  (t) => [index("reports_user_idx").on(t.userId, t.createdAt)],
);

export const agentRuns = sqliteTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    reportId: text("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    purpose: text("purpose", { enum: ["reproduce", "verify"] }).notNull().default("reproduce"),
    status: text("status", { enum: ["running", "done", "stopped", "failed"] }).notNull().default("running"),
    reproduced: integer("reproduced", { mode: "boolean" }),
    summary: text("summary"),
    steps: integer("steps").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    /** The model conversation so far (screenshots trimmed), so the next step can continue it. */
    history: text("history", { mode: "json" }).notNull(),
    ...timestamps,
  },
  (t) => [index("agent_runs_report_idx").on(t.reportId)],
);

/** What the live view shows: each observation, action and result of a run, in order. */
export const agentEvents = sqliteTable(
  "agent_events",
  {
    runId: text("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    kind: text("kind", { enum: ["observation", "action", "done", "error"] }).notNull(),
    payload: text("payload", { mode: "json" }).notNull(),
    screenshotUrl: text("screenshot_url"),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.runId, t.seq] })],
);

/** Daily AI credits per account. */
export const aiUsage = sqliteTable(
  "ai_usage",
  {
    key: text("key").notNull(),
    day: text("day").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.day] })],
);

/** Where an app's source lives, how to test and run it, and which pages (origins) belong to it. */
export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Page origins that map to this project, e.g. ["http://localhost:4400", "https://shop.example.com"]. */
    origins: text("origins", { mode: "json" }).$type<string[]>().notNull(),
    sourceType: text("source_type", { enum: ["local", "github"] }).notNull(),
    localPath: text("local_path"),
    githubRepo: text("github_repo"),
    githubBranch: text("github_branch"),
    /** AES-GCM sealed (see crypto.ts). */
    githubToken: text("github_token"),
    checkCommand: text("check_command"),
    startCommand: text("start_command"),
    appPort: integer("app_port"),
    signInPath: text("sign_in_path"),
    signInEmail: text("sign_in_email"),
    signInPassword: text("sign_in_password"),
    webhookUrl: text("webhook_url"),
    ...timestamps,
  },
  (t) => [index("projects_user_idx").on(t.userId)],
);

/** One proposed fix for a report, and what happened to it. */
export const fixes = sqliteTable(
  "fixes",
  {
    id: text("id").primaryKey(),
    reportId: text("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    status: text("status", { enum: ["proposed", "applied", "pr_opened", "failed"] }).notNull().default("proposed"),
    explanation: text("explanation").notNull(),
    edits: text("edits", { mode: "json" }).$type<{ path: string; search: string; replace: string }[]>().notNull(),
    diff: text("diff").notNull(),
    testHint: text("test_hint"),
    filesRead: integer("files_read").notNull().default(0),
    wholeRepo: integer("whole_repo", { mode: "boolean" }).notNull().default(false),
    sandbox: text("sandbox", { mode: "json" }),
    prUrl: text("pr_url"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    ...timestamps,
  },
  (t) => [index("fixes_report_idx").on(t.reportId)],
);
