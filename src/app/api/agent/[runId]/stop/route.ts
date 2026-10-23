import { apiError, apiUser } from "@/server/request";
import { addEvent, getRun, updateRun } from "@/server/services/runs";

/** Stops a run (from the live view or the extension). The extension's next step call gets a 409. */
export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const user = await apiUser(request);
  if (!user) return apiError(401, "Not signed in");
  const run = await getRun((await params).runId, user.id);
  if (!run) return apiError(404, "Run not found");
  if (run.status === "running") {
    await updateRun(run.id, { status: "stopped", summary: "Stopped by you" });
    await addEvent(run.id, "error", { message: "Stopped by you" });
  }
  return Response.json({ ok: true });
}
