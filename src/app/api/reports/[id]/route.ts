import { z } from "zod";
import { getSessionUser } from "@/server/auth";
import { apiError } from "@/server/request";
import { deleteReport, getReport, setShared } from "@/server/services/reports";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return apiError(401, "Not signed in");
  const { id } = await params;
  const body = z.object({ shared: z.boolean() }).safeParse(await request.json().catch(() => null));
  if (!body.success) return apiError(400, "Send { shared: boolean }");
  if (!(await getReport(id, user.id))) return apiError(404, "Report not found");
  await setShared(id, user.id, body.data.shared);
  return Response.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: Params) {
  const user = await getSessionUser();
  if (!user) return apiError(401, "Not signed in");
  await deleteReport((await params).id, user.id);
  return Response.json({ ok: true });
}
