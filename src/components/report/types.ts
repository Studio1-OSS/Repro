import type { Analysis, Breakpoint, Device, Frame, PageStateData, ReportLogs } from "@/shared/schemas";

/** A report as the client components get it (dates as ISO strings). */
export type ReportData = {
  id: string;
  title: string;
  note: string | null;
  pageUrl: string;
  kind: "video" | "screenshot" | "replay" | "responsive";
  videoUrl: string | null;
  replayUrl: string | null;
  pageState: PageStateData | null;
  breakpoints: Breakpoint[] | null;
  durationMs: number | null;
  frames: Frame[];
  logs: ReportLogs;
  device: Device;
  status: "new" | "analyzing" | "ready" | "failed";
  analysis: Analysis | null;
  analysisError: string | null;
  shared: boolean;
  shareSlug: string;
  createdAt: string;
};

export type RunSummary = { id: string; purpose: "reproduce" | "verify"; status: "running" | "done" | "stopped" | "failed"; reproduced: boolean | null; steps: number; createdAt: string };

/** Seconds covered by the report: the recording, or the last thing that happened in it. */
export function reportDuration(r: ReportData): number {
  if (r.durationMs) return r.durationMs / 1000;
  const ts = [...r.frames.map((f) => f.t), ...r.logs.console.map((c) => c.t), ...r.logs.network.map((n) => n.t), ...r.logs.actions.map((a) => a.t)];
  return Math.max(1, ...ts);
}

export const isFailedRequest = (status: number) => status === 0 || status >= 400;
