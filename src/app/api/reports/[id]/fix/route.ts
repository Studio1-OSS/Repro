import { formatLogs, formatPageState } from "@/server/ai/analyze";
import { proposeFix } from "@/server/ai/fix";
import { getSessionUser } from "@/server/auth";
import { aiConfig, apiError, spendAi } from "@/server/request";
import { createFix } from "@/server/services/fixes";
import { projectForUrl, sourceFor } from "@/server/services/projects";
import { getReport } from "@/server/services/reports";
import { listRuns } from "@/server/services/runs";
import { ndjson } from "@/server/stream";

export const maxDuration = 300;

/** Has the model read the project's source and propose a fix. Streams progress, then the fix. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return apiError(401, "Not signed in");
  const report = await getReport((await params).id, user.id);
  if (!report) return apiError(404, "Report not found");
  if (!report.analysis) return apiError(409, "Wait for the AI report first.");
  const project = await projectForUrl(user.id, report.pageUrl);
  if (!project) return apiError(409, `No project covers ${new URL(report.pageUrl).origin}. Add one under Projects.`);
  const denied = await spendAi(user, "fix");
  if (denied) return denied;

  const reproducedRun = (await listRuns(report.id, user.id)).find((r) => r.purpose === "reproduce" && r.reproduced);
  return ndjson(async (send) => {
    const source = sourceFor(project);
    send({ type: "progress", text: `Source: ${source.label}` });
    const proposal = await proposeFix(
      aiConfig(),
      source,
      { title: report.title, pageUrl: report.pageUrl, note: report.note, analysis: report.analysis!, logs: formatLogs(report.logs), reproduced: reproducedRun?.summary ?? undefined, pageState: report.pageState ? formatPageState(report.pageState) : undefined },
      { onProgress: (text) => send({ type: "progress", text }) },
    );
    const fix = await createFix(report.id, user.id, project.id, proposal);
    return { fix };
  });
}
