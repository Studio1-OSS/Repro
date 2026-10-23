import { getSessionUser } from "@/server/auth";
import { apiError } from "@/server/request";
import { eventsAfter, getRun } from "@/server/services/runs";

export const maxDuration = 300;

/** Server-sent events for the live view: every new run event, then `end` when the run is over. */
export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const user = await getSessionUser();
  if (!user) return apiError(401, "Not signed in");
  const { runId } = await params;
  if (!(await getRun(runId, user.id))) return apiError(404, "Run not found");
  let after = Number(new URL(request.url).searchParams.get("after") ?? 0);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const started = Date.now();
      while (!request.signal.aborted && Date.now() - started < 280_000) {
        for (const e of await eventsAfter(runId, after)) {
          after = e.seq;
          send("step", e);
        }
        const run = await getRun(runId, user.id);
        if (!run || run.status !== "running") {
          // Events written between the read above and the status check.
          for (const e of await eventsAfter(runId, after)) send("step", e);
          send("end", { status: run?.status, reproduced: run?.reproduced, summary: run?.summary, steps: run?.steps, inputTokens: run?.inputTokens, outputTokens: run?.outputTokens });
          break;
        }
        await new Promise((r) => setTimeout(r, 700));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" } });
}
