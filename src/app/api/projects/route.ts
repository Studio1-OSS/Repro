import { features } from "@/env";
import { getSessionUser } from "@/server/auth";
import { apiError } from "@/server/request";
import { listProjects, projectInputSchema, publicProject, saveProject } from "@/server/services/projects";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return apiError(401, "Not signed in");
  return Response.json({ projects: (await listProjects(user.id)).map(publicProject), selfHosted: features.selfHosted });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return apiError(401, "Not signed in");
  const parsed = projectInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, parsed.error.issues[0]?.message ?? "Check the form", { issues: parsed.error.issues.slice(0, 5) });
  if (parsed.data.sourceType === "local" && !features.selfHosted) return apiError(400, "Local folders only work when Repro runs on your own machine or server.");
  return Response.json({ project: publicProject(await saveProject(user.id, parsed.data)) }, { status: 201 });
}
