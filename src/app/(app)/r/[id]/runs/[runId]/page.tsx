import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LiveRun } from "@/components/agent/live-run";
import { requireUser } from "@/server/auth";
import { getReport } from "@/server/services/reports";
import { getRun } from "@/server/services/runs";

export const metadata: Metadata = { title: "Reproduce run" };

export default async function RunPage({ params }: { params: Promise<{ id: string; runId: string }> }) {
  const { id, runId } = await params;
  const user = await requireUser(`/r/${id}/runs/${runId}`);
  const [report, run] = await Promise.all([getReport(id, user.id), getRun(runId, user.id)]);
  if (!report || !run || run.reportId !== report.id) notFound();
  return <LiveRun runId={run.id} reportId={report.id} reportTitle={report.title} initialStatus={run.status} purpose={run.purpose} />;
}
