import { features } from "@/env";
import { applyEdits } from "@/server/ai/fix";
import { getSessionUser } from "@/server/auth";
import { apiError } from "@/server/request";
import { getFix, updateFix } from "@/server/services/fixes";
import { getProject } from "@/server/services/projects";
import { localSource } from "@/server/source/local";

/** Writes a fix into the project's local folder (self-hosted Repro only). */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return apiError(401, "Not signed in");
  if (!features.selfHosted) return apiError(400, "Applying to a folder only works on self-hosted Repro.");
  const fix = await getFix((await params).id, user.id);
  const project = fix?.projectId ? await getProject(fix.projectId, user.id) : null;
  if (!fix || !project) return apiError(404, "Fix not found");
  if (project.sourceType !== "local" || !project.localPath) return apiError(409, "This project's source is on GitHub: open a pull request instead.");
  const source = localSource(project.localPath);
  const files = new Map<string, string>();
  for (const e of fix.edits) {
    const current = await source.read(e.path).catch(() => undefined);
    if (current !== undefined) files.set(e.path, current);
  }
  const applied = applyEdits(files, fix.edits);
  if (applied.errors.length) return apiError(409, `The files changed since the fix was written: ${applied.errors.join("; ")}`);
  for (const path of new Set(fix.edits.map((e) => e.path))) await source.write(path, applied.files.get(path)!);
  await updateFix(fix.id, { status: "applied" });
  return Response.json({ ok: true, files: [...new Set(fix.edits.map((e) => e.path))] });
}
