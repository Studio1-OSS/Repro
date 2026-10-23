import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { redactLogs, redactText } from "@/shared/redact";
import type { Analysis, Breakpoint, CreateReport, Device, Frame, PageStateData, ReportLogs } from "@/shared/schemas";
import { db, schema } from "../db";

export type Report = Omit<typeof schema.reports.$inferSelect, "logs" | "device" | "analysis" | "frames" | "pageState" | "breakpoints"> & {
  frames: Frame[];
  pageState: PageStateData | null;
  breakpoints: Breakpoint[] | null;
  logs: ReportLogs;
  device: Device;
  analysis: Analysis | null;
};

const asReport = (row: typeof schema.reports.$inferSelect): Report => row as Report;

export async function createReport(userId: string, input: CreateReport): Promise<Report> {
  const [row] = await db
    .insert(schema.reports)
    .values({
      id: nanoid(12),
      userId,
      title: input.note || `Bug on ${new URL(input.pageUrl).host}`,
      note: input.note,
      pageUrl: input.pageUrl,
      kind: input.kind,
      videoUrl: input.videoUrl,
      replayUrl: input.replayUrl,
      pageState: input.pageState && {
        ...input.pageState,
        storage: {
          ...input.pageState.storage,
          local: input.pageState.storage.local.map((e) => ({ key: e.key, value: redactText(e.value) })),
          session: input.pageState.storage.session.map((e) => ({ key: e.key, value: redactText(e.value) })),
        },
      },
      breakpoints: input.breakpoints,
      durationMs: input.durationMs,
      frames: input.frames,
      // The extension redacts before upload; this second pass covers any other client.
      logs: redactLogs(input.logs),
      device: input.device,
      shareSlug: nanoid(16),
    })
    .returning();
  return asReport(row);
}

export async function getReport(id: string, userId: string): Promise<Report | null> {
  const row = await db.query.reports.findFirst({ where: and(eq(schema.reports.id, id), eq(schema.reports.userId, userId)) });
  return row ? asReport(row) : null;
}

export async function getSharedReport(slug: string): Promise<Report | null> {
  const row = await db.query.reports.findFirst({ where: and(eq(schema.reports.shareSlug, slug), eq(schema.reports.shared, true)) });
  return row ? asReport(row) : null;
}

export async function listReports(userId: string, limit = 60): Promise<Report[]> {
  const rows = await db.query.reports.findMany({ where: eq(schema.reports.userId, userId), orderBy: desc(schema.reports.createdAt), limit });
  return rows.map(asReport);
}

export async function setReportStatus(id: string, status: Report["status"], fields: { analysis?: Analysis; analysisError?: string | null } = {}) {
  await db
    .update(schema.reports)
    .set({ status, ...(fields.analysis ? { analysis: fields.analysis, title: fields.analysis.title } : {}), ...(fields.analysisError !== undefined ? { analysisError: fields.analysisError } : {}) })
    .where(eq(schema.reports.id, id));
}

export async function setShared(id: string, userId: string, shared: boolean) {
  await db.update(schema.reports).set({ shared }).where(and(eq(schema.reports.id, id), eq(schema.reports.userId, userId)));
}

export async function deleteReport(id: string, userId: string) {
  await db.delete(schema.reports).where(and(eq(schema.reports.id, id), eq(schema.reports.userId, userId)));
}

/** The shape client components get (dates as strings). */
export function toReportData(r: Report): import("@/components/report/types").ReportData {
  return {
    id: r.id,
    title: r.title,
    note: r.note,
    pageUrl: r.pageUrl,
    kind: r.kind,
    videoUrl: r.videoUrl,
    replayUrl: r.replayUrl,
    pageState: r.pageState,
    breakpoints: r.breakpoints,
    durationMs: r.durationMs,
    frames: r.frames,
    logs: r.logs,
    device: r.device,
    status: r.status,
    analysis: r.analysis,
    analysisError: r.analysisError,
    shared: r.shared,
    shareSlug: r.shareSlug,
    createdAt: r.createdAt.toISOString(),
  };
}
