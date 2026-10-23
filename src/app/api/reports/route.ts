import { createReportSchema } from "@/shared/schemas";
import { apiError, apiUser, appUrl } from "@/server/request";
import { projectForUrl } from "@/server/services/projects";
import { createReport } from "@/server/services/reports";
import { notifyWebhook } from "@/server/services/webhook";

/** The extension posts a capture here after uploading its media. */
export async function POST(request: Request) {
  const user = await apiUser(request);
  if (!user) return apiError(401, "Not signed in");
  const parsed = createReportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, "That report doesn't look right", { issues: parsed.error.issues.slice(0, 5) });
  const report = await createReport(user.id, parsed.data);
  const url = `${appUrl()}/r/${report.id}`;
  const project = await projectForUrl(user.id, report.pageUrl);
  if (project?.webhookUrl) void notifyWebhook(project.webhookUrl, { title: report.title, url, pageUrl: report.pageUrl, kind: report.kind });
  return Response.json({ id: report.id, url }, { status: 201 });
}
