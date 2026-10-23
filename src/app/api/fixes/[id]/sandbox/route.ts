import { features } from "@/env";
import { getSessionUser } from "@/server/auth";
import { checkFixInSandbox } from "@/server/sandbox/check";
import { aiConfig, apiError, spendAi } from "@/server/request";
import { getFix, updateFix } from "@/server/services/fixes";
import { getProject, sandboxTargetFor } from "@/server/services/projects";
import { getReport } from "@/server/services/reports";
import { storage } from "@/server/request";
import { ndjson } from "@/server/stream";

export const maxDuration = 600;

/** Runs the project's tests and the reproduce agent on the original and the patched code, in a local sandbox. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return apiError(401, "Not signed in");
  if (!features.selfHosted) return apiError(400, "The sandbox runs on self-hosted Repro (your machine or server), not on serverless hosting.");
  const fix = await getFix((await params).id, user.id);
  if (!fix) return apiError(404, "Fix not found");
  const [report, project] = await Promise.all([getReport(fix.reportId, user.id), fix.projectId ? getProject(fix.projectId, user.id) : null]);
  if (!report?.analysis || !project) return apiError(409, "The report or its project is gone.");
  if (!project.checkCommand && !(project.startCommand && project.appPort)) return apiError(409, "Set a test command, or a start command and port, on the project.");
  const denied = await spendAi(user, "sandbox");
  if (denied) return denied;

  return ndjson(async (send) => {
    const target = await sandboxTargetFor(project, report.pageUrl);
    const result = await checkFixInSandbox(aiConfig(), target, { edits: fix.edits, analysis: report.analysis!, title: report.title }, { onProgress: (text) => send({ type: "progress", text }) });
    // Keep the agent's last screenshot of each side as an image, not a data URL in the database.
    const store = storage();
    for (const side of [result.before, result.after]) {
      const data = side.agent?.screenshot;
      if (data?.startsWith("data:")) side.agent!.screenshot = await store.put(Buffer.from(data.split(",")[1], "base64"), "image/jpeg").catch(() => undefined);
    }
    await updateFix(fix.id, { sandbox: result });
    return { sandbox: result };
  });
}
