import { getSessionUser } from "@/server/auth";
import { apiError } from "@/server/request";
import { deleteProject, projectInputSchema, publicProject, saveProject } from "@/server/services/projects";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return apiError(401, "Not signed in");
  const parsed = projectInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, parsed.error.issues[0]?.message ?? "Check the form");
  try {
    return Response.json({ project: publicProject(await saveProject(user.id, parsed.data, (await params).id)) });
  } catch {
    return apiError(404, "Project not found");
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return apiError(401, "Not signed in");
  await deleteProject((await params).id, user.id);
  return Response.json({ ok: true });
}
