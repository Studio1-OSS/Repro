import { applyEdits } from "@/server/ai/fix";
import { getSessionUser } from "@/server/auth";
import { apiError, appUrl } from "@/server/request";
import { getFix, updateFix } from "@/server/services/fixes";
import { getProject, openPullRequestFor, sourceFor } from "@/server/services/projects";
import { getReport } from "@/server/services/reports";

/** Opens a GitHub pull request with the fix, linking back to the report. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return apiError(401, "Not signed in");
  const fix = await getFix((await params).id, user.id);
  const project = fix?.projectId ? await getProject(fix.projectId, user.id) : null;
  const report = fix ? await getReport(fix.reportId, user.id) : null;
  if (!fix || !project || !report) return apiError(404, "Fix not found");
  if (project.sourceType !== "github") return apiError(409, "This project's source is a local folder: apply the fix instead.");
  try {
    const source = sourceFor(project);
    const files = new Map<string, string>();
    for (const e of fix.edits) {
      const current = await source.read(e.path).catch(() => undefined);
      if (current !== undefined) files.set(e.path, current);
    }
    const applied = applyEdits(files, fix.edits);
    if (applied.errors.length) throw new Error(`The branch changed since the fix was written: ${applied.errors.join("; ")}`);
    const verified = fix.sandbox?.verified ? `\n\n✅ Verified in the Repro sandbox: ${fix.sandbox.summary}.` : "";
    const url = await openPullRequestFor(project, {
      title: `Fix: ${report.title}`.slice(0, 120),
      body: `${fix.explanation}${verified}\n\nBug report with the recording, console and network logs: ${appUrl()}/r/${report.id}\n\n_Proposed by MiniMax-M3.1-Flash in Repro._`,
      branch: `repro/fix-${fix.id}`,
      files: [...new Set(fix.edits.map((e) => e.path))].map((path) => ({ path, content: applied.files.get(path)! })),
    });
    await updateFix(fix.id, { status: "pr_opened", prUrl: url });
    return Response.json({ url });
  } catch (e) {
    return apiError(502, (e as Error).message);
  }
}
