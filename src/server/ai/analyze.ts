// Bug analysis: the recording (as timestamped frames) plus every captured log line → one structured report.
// No server-only imports: the bench runs this exact code.
import { z } from "zod";
import { analysisSchema, type Analysis, type Breakpoint, type Device, type Frame, type PageStateData, type ReportLogs } from "@/shared/schemas";
import { chatJSON, type Content, type NebiusConfig } from "./nebius";

const { $schema: _s, ...analysisJsonSchema } = z.toJSONSchema(analysisSchema, { target: "draft-7" });

export const ANALYSIS_SYSTEM_PROMPT = `You are a senior QA engineer. A user recorded a bug in their browser. You get the reporter's note (what they say went wrong; trust it as the symptom to explain), frames from the recording (in time order, each labelled with its timestamp), the user's clicks and inputs, the console output and the network requests.

Write a bug report a developer can act on:
- title: what breaks and where, specific (not "Bug on page").
- steps: the user's actions in order, each with the timestamp (seconds) where it happens in the recording. Use the action log for exact labels and values; use the frames to see what was on screen. Include the step where the bug shows.
- expected vs actual: concrete values from the screen ("Total shows $NaN" not "total is wrong").
- suspectedCause: tie it to evidence: a failing request, a response field the UI didn't expect, a console error and its location. Say what to check in the code.
- evidence: short quotes of the log lines you relied on.
- layout: for responsive scans you get one screenshot per viewport width plus layout facts measured in the page (overflow, elements off-screen, overlaps, clipped text, small tap targets). Confirm each against the screenshot and report the real ones with a concrete CSS fix. Leave it empty for other reports unless a frame clearly shows a layout break.
- security: only real problems you can see in this capture. Every entry under SECRETS REMOVED BEFORE UPLOAD is a real exposure (for example an API key or token sent in a URL, where logs, history and referrers keep it): report each one, saying where it appeared. Also look for credentials over http, PII in URLs, missing auth on sensitive endpoints, overly permissive CORS. Leave it empty when there's nothing; never pad it with generic advice.
Be precise and brief. Don't invent anything that isn't in the frames or logs.`;

export type AnalysisInput = {
  /** What the reporter wrote ("Quantity jumps by two"): often the only sign of a logic bug. */
  note?: string;
  pageUrl: string;
  device: Device;
  durationMs?: number;
  frames: Frame[];
  logs: ReportLogs;
  /** Public video URL, used instead of frames when AI_VIDEO_INPUT=1. */
  videoUrl?: string;
  pageState?: PageStateData | null;
  /** Responsive scans: one screenshot per width (urls the model can open) with measured layout facts. */
  breakpoints?: Breakpoint[] | null;
};

/** How many of the latest frames are sent at full detail; earlier ones go at low detail (~1/3 of the tokens). */
const FULL_DETAIL_FRAMES = 3;

const fmtT = (t: number) => `${t.toFixed(1)}s`;
const oneLine = (s: string, max: number) => {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};

/** Logs as compact text: one line per event, far fewer tokens than JSON. */
export function formatLogs(logs: ReportLogs): string {
  const actions = logs.actions.map((a) => `[${fmtT(a.t)}] ${a.type}${a.target ? ` ${a.target}` : ""}${a.value !== undefined ? ` = ${JSON.stringify(a.value)}` : ""}${a.url ? ` ${a.url}` : ""}`);
  const consoleLines = logs.console.map((c) => `[${fmtT(c.t)}] ${c.level}: ${oneLine(c.text, 600)}${c.stack ? `\n    ${oneLine(c.stack, 400)}` : ""}`);
  const network = logs.network.map((n) => {
    const head = `[${fmtT(n.t)}] ${n.method} ${n.url} → ${n.status || "failed"}${n.error ? ` (${n.error})` : ""} ${Math.round(n.durationMs)}ms`;
    const headers = Object.entries(n.requestHeaders)
      .filter(([k]) => !/^(accept|accept-language|accept-encoding|user-agent|sec-|referer|origin|content-length|connection|host)/i.test(k))
      .map(([k, v]) => `${k}: ${v}`)
      .join("; ");
    const parts = [head];
    if (headers) parts.push(`    request headers: ${oneLine(headers, 400)}`);
    if (n.requestBody) parts.push(`    request body: ${oneLine(n.requestBody, 800)}`);
    if (n.responseBody) parts.push(`    response: ${oneLine(n.responseBody, 1200)}`);
    return parts.join("\n");
  });
  const secrets = (logs.removedSecrets ?? []).map((r) => `[${fmtT(r.t)}] ${r.kind} in ${r.where}`);
  return [
    ...(secrets.length ? [`SECRETS REMOVED BEFORE UPLOAD (${secrets.length}): these values were really sent by the page; they were stripped only from this capture`, ...secrets, ""] : []),
    `ACTIONS (${actions.length})`,
    ...(actions.length ? actions : ["(none)"]),
    "",
    `CONSOLE (${consoleLines.length})`,
    ...(consoleLines.length ? consoleLines : ["(none)"]),
    "",
    `NETWORK (${network.length})`,
    ...(network.length ? network : ["(none)"]),
  ].join("\n");
}

/** Performance and storage as a few lines (values are already redacted). */
export function formatPageState(state: PageStateData): string {
  const p = state.perf;
  const ms = (v: number | null) => (v === null ? "n/a" : `${v} ms`);
  const longTotal = p.longTasks.reduce((a, t) => a + t.duration, 0);
  const keys = (list: { key: string }[]) => (list.length ? list.map((e) => e.key).join(", ") : "(none)");
  return [
    "PAGE STATE",
    `Performance: TTFB ${ms(p.ttfb)}, DOMContentLoaded ${ms(p.domContentLoaded)}, load ${ms(p.load)}, LCP ${ms(p.lcp)}, CLS ${p.cls}, INP ${ms(p.inp)}, ${p.longTasks.length} long tasks (${longTotal} ms total), JS heap ${p.jsHeapMb ?? "n/a"} MB, ${p.resources} resources`,
    `localStorage keys: ${keys(state.storage.local)}`,
    `sessionStorage keys: ${keys(state.storage.session)}`,
    `Cookies (names only): ${state.storage.cookies.join(", ") || "(none)"}`,
  ].join("\n");
}

/** The user message: context, then frames (or the video), then the logs. */
export function buildAnalysisContent(input: AnalysisInput, opts: { videoInput?: boolean } = {}): Content {
  const d = input.device;
  const header = [
    input.note ? `The reporter says: "${input.note}"` : "The reporter didn't write a note; work out the bug from the recording and logs.",
    `Page: ${input.pageUrl}${d.pageTitle ? ` (${d.pageTitle})` : ""}`,
    `Browser: ${d.browser} on ${d.os}, viewport ${d.viewport.width}×${d.viewport.height} @${d.pixelRatio}x, ${d.language}, ${d.timezone}`,
    input.durationMs ? `Recording length: ${fmtT(input.durationMs / 1000)}` : "Single screenshot",
  ].join("\n");

  const media: Content = input.breakpoints?.length
    ? input.breakpoints.flatMap((b): Content => [
        {
          type: "text",
          text: `Viewport ${b.width}×${b.height}px. Measured: page ${b.audit.pageWidth}px wide${b.audit.overflowX > 0 ? `, ${b.audit.overflowX}px horizontal overflow` : ""}${b.audit.issues.length ? `; ${b.audit.issues.map((i) => `${i.kind}: ${i.element} (${i.detail})`).join("; ")}` : "; no layout problems measured"}.`,
        },
        { type: "image_url", image_url: { url: b.url, detail: "high" } },
      ])
    : opts.videoInput && input.videoUrl
      ? [{ type: "text", text: "Recording:" }, { type: "video_url", video_url: { url: input.videoUrl } } as unknown as Content[number]]
      : input.frames.flatMap((f, i): Content => [
          { type: "text", text: `Frame at t=${fmtT(f.t)}:` },
          { type: "image_url", image_url: { url: f.url, detail: i >= input.frames.length - FULL_DETAIL_FRAMES ? "high" : "low" } },
        ]);

  return [
    { type: "text", text: header },
    ...media,
    ...(input.pageState ? [{ type: "text" as const, text: formatPageState(input.pageState) }] : []),
    { type: "text", text: formatLogs(input.logs) },
  ];
}

export async function analyzeReport(
  config: NebiusConfig,
  input: AnalysisInput,
  opts: { videoInput?: boolean; onReasoning?: (delta: string) => void } = {},
): Promise<Analysis> {
  const analysis = await chatJSON(config, {
    system: ANALYSIS_SYSTEM_PROMPT,
    content: buildAnalysisContent(input, opts),
    schema: analysisSchema,
    jsonSchema: analysisJsonSchema,
    name: "bug_report",
    effort: "medium",
    onReasoning: opts.onReasoning,
  });
  const end = (input.durationMs ?? 0) / 1000;
  return {
    ...analysis,
    // Keep step markers on the timeline even if the model rounds past the end.
    steps: analysis.steps.map((s) => ({ ...s, t: Math.max(0, end ? Math.min(s.t, end) : s.t) })).sort((a, b) => a.t - b.t),
  };
}
