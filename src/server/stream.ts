import "server-only";

/**
 * A newline-delimited JSON response for long jobs: `send` streams {type:"progress"} lines, and whatever the
 * job returns is sent last as {type:"done", ...}. A thrown error becomes {type:"error", message}.
 */
export function ndjson(job: (send: (line: object) => void) => Promise<object>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // If the browser goes away mid-job, keep working (the result is saved) and just stop writing.
      let open = true;
      const send = (line: object) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
        } catch {
          open = false;
        }
      };
      try {
        send({ type: "done", ...(await job(send)) });
      } catch (e) {
        console.error("job failed", e);
        send({ type: "error", message: (e as Error).message || "Something went wrong" });
      }
      try {
        controller.close();
      } catch {}
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
