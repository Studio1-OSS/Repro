import { env } from "@/env";
import { analyzeReport } from "@/server/ai/analyze";
import { AIError } from "@/server/ai/nebius";
import { getSessionUser } from "@/server/auth";
import { aiConfig, apiError, spendAi } from "@/server/request";
import { getReport, setReportStatus } from "@/server/services/reports";
import { urlForModel } from "@/server/storage";

export const maxDuration = 300;

/**
 * Writes the AI report. Streams newline-delimited JSON: {type:"reasoning",text} while the model thinks,
 * then {type:"done",analysis} or {type:"error",message}.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return apiError(401, "Not signed in");
  const report = await getReport((await params).id, user.id);
  if (!report) return apiError(404, "Report not found");
  if (report.analysis) return Response.json({ type: "done", analysis: report.analysis });
  const denied = await spendAi(user, "analyze");
  if (denied) return denied;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // If the browser goes away mid-analysis (the person navigated), keep going: the report is still saved.
      let open = true;
      const send = (line: object) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
        } catch {
          open = false;
        }
      };
      await setReportStatus(report.id, "analyzing");
      try {
        const frames = await Promise.all(report.frames.map(async (f) => ({ t: f.t, url: await urlForModel(f.url) })));
        const breakpoints = report.breakpoints && (await Promise.all(report.breakpoints.map(async (b) => ({ ...b, url: await urlForModel(b.url) }))));
        const analysis = await analyzeReport(
          aiConfig(),
          { note: report.note ?? undefined, pageUrl: report.pageUrl, device: report.device, durationMs: report.durationMs ?? undefined, frames, logs: report.logs, videoUrl: report.videoUrl ?? undefined, pageState: report.pageState, breakpoints },
          { videoInput: env.AI_VIDEO_INPUT === "1" && Boolean(report.videoUrl?.startsWith("https://")), onReasoning: (text) => send({ type: "reasoning", text }) },
        );
        await setReportStatus(report.id, "ready", { analysis, analysisError: null });
        send({ type: "done", analysis });
      } catch (e) {
        const message = e instanceof AIError ? e.message : "The analysis failed. Try again.";
        console.error("analysis failed", e);
        await setReportStatus(report.id, "failed", { analysisError: message });
        send({ type: "error", message });
      }
      try {
        controller.close();
      } catch {}
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
