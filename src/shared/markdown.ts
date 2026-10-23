import type { Analysis, Device } from "./schemas";

/** Markdown for "Copy as GitHub issue". */
export function analysisToMarkdown(a: Analysis, ctx: { pageUrl: string; reportUrl: string; device: Device }): string {
  const lines = [
    `**${a.summary}**`,
    "",
    "### Steps to reproduce",
    ...a.steps.map((s, i) => `${i + 1}. ${s.action} _(at ${s.t.toFixed(1) + "s"})_`),
    "",
    `**Expected:** ${a.expected}`,
    `**Actual:** ${a.actual}`,
    "",
    "### Likely cause",
    a.suspectedCause,
    ...(a.evidence.length ? ["", ...a.evidence.map((e) => `- \`${e.replace(/`/g, "'")}\``)] : []),
    ...((a.layout ?? []).length ? ["", "### Layout", ...a.layout.map((l) => `- **${l.width}px** ${l.element}: ${l.issue} → ${l.suggestion}`)] : []),
    ...(a.security.length ? ["", "### Security", ...a.security.map((s) => `- **${s.severity}**: ${s.issue} (${s.evidence})`)] : []),
    "",
    "### Environment",
    `- Page: ${ctx.pageUrl}`,
    `- ${ctx.device.browser} on ${ctx.device.os}, ${ctx.device.viewport.width}×${ctx.device.viewport.height}`,
    "",
    `Recording, console and network logs: ${ctx.reportUrl}`,
  ];
  return lines.join("\n");
}
