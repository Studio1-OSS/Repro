import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReportView } from "@/components/report/report-view";
import { requireUser } from "@/server/auth";
import { appUrl } from "@/server/request";
import { getReport, toReportData } from "@/server/services/reports";
import { listRuns } from "@/server/services/runs";
import { features } from "@/env";
import { listFixes } from "@/server/services/fixes";
import { projectForUrl } from "@/server/services/projects";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const user = await requireUser();
  const report = await getReport((await params).id, user.id);
  return { title: report?.title ?? "Report" };
}

export default async function ReportPage({ params }: Props) {
  const { id } = await params;
  const user = await requireUser(`/r/${id}`);
  const report = await getReport(id, user.id);
  if (!report) notFound();
  const [runs, project, fixes] = await Promise.all([listRuns(id, user.id), projectForUrl(user.id, report.pageUrl), listFixes(id, user.id)]);
  const fix = fixes[0];
  return (
    <ReportView
      report={toReportData(report)}
      runs={runs.map((r) => ({ id: r.id, purpose: r.purpose, status: r.status, reproduced: r.reproduced, steps: r.steps, createdAt: r.createdAt.toISOString() }))}
      appUrl={appUrl()}
      fixing={{
        selfHosted: features.selfHosted,
        project: project && {
          id: project.id,
          name: project.name,
          sourceType: project.sourceType,
          label: project.sourceType === "local" ? project.name : `${project.githubRepo}@${project.githubBranch}`,
          canSandbox: Boolean(project.checkCommand || (project.startCommand && project.appPort)),
        },
        fix: fix
          ? { id: fix.id, status: fix.status, explanation: fix.explanation, diff: fix.diff, testHint: fix.testHint, filesRead: fix.filesRead, wholeRepo: fix.wholeRepo, sandbox: fix.sandbox as never, prUrl: fix.prUrl, edits: fix.edits }
          : null,
      }}
    />
  );
}
