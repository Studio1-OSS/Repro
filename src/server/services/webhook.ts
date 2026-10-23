import "server-only";

/** Tells a project's webhook about a new report: Slack's Block Kit for Slack URLs, plain JSON otherwise. */
export async function notifyWebhook(url: string, report: { title: string; url: string; pageUrl: string; kind: string }) {
  const slack = /^https:\/\/hooks\.slack\.com\//.test(url);
  const body = slack
    ? {
        text: `New bug report: ${report.title}`,
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: `*<${report.url}|${report.title.replace(/[<>&]/g, "")}>*\n${report.kind} on ${report.pageUrl}` } },
          { type: "context", elements: [{ type: "mrkdwn", text: "Recorded with Repro. The AI report is written when someone opens it." }] },
        ],
      }
    : { event: "report.created", report };
  try {
    await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
  } catch (e) {
    console.warn("webhook failed", (e as Error).message);
  }
}
