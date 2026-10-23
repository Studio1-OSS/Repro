// Shapes shared by the web app, the browser extension and the bench. No server-only imports here.
import { z } from "zod";

export const LIMITS = {
  frames: 24,
  console: 500,
  network: 300,
  actions: 400,
  bodyChars: 10_000,
  textChars: 2_000,
  agentSteps: 25,
  /** Screenshots kept in the agent prompt; older ones become a one-line note. */
  agentScreenshots: 2,
} as const;

/** Seconds since the recording started. */
const t = z.number().min(0);

export const consoleEntrySchema = z.object({
  t,
  level: z.enum(["log", "info", "warn", "error", "debug"]),
  text: z.string().max(LIMITS.textChars),
  stack: z.string().max(LIMITS.textChars).optional(),
});

export const networkEntrySchema = z.object({
  t,
  kind: z.enum(["fetch", "xhr"]),
  method: z.string().max(16),
  url: z.string().max(LIMITS.textChars),
  /** 0 when the request never got a response. */
  status: z.number().int(),
  durationMs: z.number().min(0),
  requestHeaders: z.record(z.string(), z.string()).default({}),
  responseHeaders: z.record(z.string(), z.string()).default({}),
  requestBody: z.string().max(LIMITS.bodyChars).optional(),
  responseBody: z.string().max(LIMITS.bodyChars).optional(),
  error: z.string().max(LIMITS.textChars).optional(),
});

export const actionEventSchema = z.object({
  t,
  type: z.enum(["click", "input", "key", "navigate", "scroll"]),
  /** Human-readable target, e.g. `button "Apply coupon"`. */
  target: z.string().max(300).optional(),
  value: z.string().max(500).optional(),
  url: z.string().max(LIMITS.textChars).optional(),
});

export const deviceSchema = z.object({
  userAgent: z.string().max(500),
  browser: z.string().max(100),
  os: z.string().max(100),
  viewport: z.object({ width: z.number(), height: z.number() }),
  pixelRatio: z.number(),
  language: z.string().max(40),
  timezone: z.string().max(80),
  pageTitle: z.string().max(300).optional(),
  /** Set when the tab was emulating a device while recording, e.g. "iPhone 15 (393×852)". */
  emulated: z.string().max(80).optional(),
});

/** A secret the recorder removed before upload: what kind, where it was, when. Never the value. */
export const removedSecretSchema = z.object({ t, kind: z.string().max(60), where: z.string().max(500) });

export const reportLogsSchema = z.object({
  console: z.array(consoleEntrySchema).max(LIMITS.console),
  network: z.array(networkEntrySchema).max(LIMITS.network),
  actions: z.array(actionEventSchema).max(LIMITS.actions),
  removedSecrets: z.array(removedSecretSchema).max(50).optional(),
});

export const frameSchema = z.object({ t, url: z.string().min(1) });

/** DevTools-style page state at capture time (see collectPageState() in page-runtime.js). */
export const pageStateSchema = z.object({
  perf: z.object({
    ttfb: z.number().nullable(),
    domContentLoaded: z.number().nullable(),
    load: z.number().nullable(),
    lcp: z.number().nullable(),
    cls: z.number(),
    inp: z.number().nullable(),
    longTasks: z.array(z.object({ start: z.number(), duration: z.number() })).max(50),
    jsHeapMb: z.number().nullable(),
    resources: z.number(),
  }),
  storage: z.object({
    local: z.array(z.object({ key: z.string().max(200), value: z.string().max(300) })).max(100),
    session: z.array(z.object({ key: z.string().max(200), value: z.string().max(300) })).max(100),
    cookies: z.array(z.string().max(200)).max(100),
  }),
  /** URL of the uploaded script-free DOM snapshot (HTML). */
  domUrl: z.string().optional(),
});

/** One breakpoint of a responsive scan: a screenshot and the layout facts measured in the page. */
export const breakpointSchema = z.object({
  width: z.number().int(),
  height: z.number().int(),
  url: z.string().min(1),
  audit: z.object({
    pageWidth: z.number(),
    overflowX: z.number(),
    issues: z.array(z.object({ kind: z.string().max(40), element: z.string().max(200), detail: z.string().max(300) })).max(40),
  }),
});

/** What the extension (or the bench) uploads after storing the media. */
export const createReportSchema = z.object({
  /** The reporter's note: what went wrong, in their words. Also the title until the analysis writes one. */
  note: z.string().trim().max(500).optional(),
  pageUrl: z.string().url().max(LIMITS.textChars),
  kind: z.enum(["video", "screenshot", "replay", "responsive"]),
  videoUrl: z.string().min(1).optional(),
  /** rrweb events (JSON) for the inspectable DOM replay. */
  replayUrl: z.string().min(1).optional(),
  pageState: pageStateSchema.optional(),
  breakpoints: z.array(breakpointSchema).max(6).optional(),
  durationMs: z.number().int().min(0).optional(),
  frames: z.array(frameSchema).min(1).max(LIMITS.frames),
  logs: reportLogsSchema,
  device: deviceSchema,
});

// ── AI analysis ──────────────────────────────────────────────────────────────────────

export const analysisSchema = z.object({
  title: z.string().describe("Specific bug title, under 90 characters: what breaks, where"),
  summary: z.string().describe("Two or three sentences a developer can act on"),
  severity: z.enum(["low", "medium", "high", "critical"]),
  steps: z
    .array(
      z.object({
        t: z.number().describe("Seconds into the recording where this step happens"),
        action: z.string().describe("One user action, imperative, e.g. 'Click \"Apply coupon\"'"),
      }),
    )
    .describe("Steps to reproduce, in order, from the frames and the action log"),
  expected: z.string(),
  actual: z.string(),
  suspectedCause: z.string().describe("The most likely cause, pointing at the specific request, response field or console error"),
  evidence: z.array(z.string()).describe("Short quotes from the logs that support the cause, e.g. 'GET /api/x → 500'"),
  security: z
    .array(
      z.object({
        issue: z.string(),
        severity: z.enum(["low", "medium", "high"]),
        evidence: z.string(),
      }),
    )
    .describe("Real security problems visible in the captured traffic or page. Empty when there are none; don't pad"),
  layout: z
    .array(
      z.object({
        width: z.number().describe("Viewport width in px where the problem shows"),
        element: z.string().describe("Which element, e.g. 'Place order button' or '.checkout-row'"),
        issue: z.string().describe("What's wrong: overflow, overlap, cut-off text, tiny tap target, hidden content…"),
        severity: z.enum(["low", "medium", "high"]),
        suggestion: z.string().describe("A concrete CSS or layout fix"),
      }),
    )
    .describe("Layout problems at specific widths. Only for responsive scans or when frames clearly show one; otherwise empty"),
});
export type Analysis = z.infer<typeof analysisSchema>;

// ── Reproduce agent ──────────────────────────────────────────────────────────────────

export const agentObservationSchema = z.object({
  url: z.string().max(LIMITS.textChars),
  title: z.string().max(300).default(""),
  /** JPEG data URL of the visible tab. */
  screenshot: z.string().startsWith("data:image/"),
  /** Numbered interactive elements, one per line: `[3] button "Apply coupon"`. */
  elements: z.string().max(20_000),
  /** Visible text of the page, trimmed. */
  text: z.string().max(4_000).default(""),
  consoleErrors: z.array(z.string().max(500)).max(20).default([]),
  /** What happened when the previous action ran, e.g. "ok" or "error: element 7 not found". */
  lastResult: z.string().max(500).optional(),
});

export const agentActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("click"), id: z.number().int() }),
  /** Fallback for things the element list can't name (canvas, maps, custom widgets): CSS-pixel coordinates on the screenshot. */
  z.object({ type: z.literal("click_at"), x: z.number().min(0).max(10_000), y: z.number().min(0).max(10_000) }),
  z.object({ type: z.literal("type"), id: z.number().int(), text: z.string().max(2_000), submit: z.boolean().optional() }),
  z.object({ type: z.literal("select"), id: z.number().int(), option: z.string().max(200) }),
  z.object({ type: z.literal("press"), key: z.string().max(30) }),
  z.object({ type: z.literal("scroll"), direction: z.enum(["up", "down"]) }),
  z.object({ type: z.literal("navigate"), url: z.string().max(LIMITS.textChars) }),
  z.object({ type: z.literal("wait"), ms: z.number().int().min(100).max(5_000) }),
  z.object({ type: z.literal("done"), reproduced: z.boolean(), evidence: z.string().max(2_000) }),
  /** Can't go on (a sign-in wall, CAPTCHA, 2FA…): ends the run without a verdict. */
  z.object({ type: z.literal("give_up"), reason: z.string().max(1_000) }),
]);

export const agentStepRequestSchema = z.object({
  /** Omit on the first step, with reportId set, to start a run. */
  runId: z.string().optional(),
  reportId: z.string().optional(),
  /** "verify": the same run after a fix was applied; the hoped-for result is "not reproduced". */
  purpose: z.enum(["reproduce", "verify"]).optional(),
  observation: agentObservationSchema,
});

export type ConsoleEntry = z.infer<typeof consoleEntrySchema>;
export type NetworkEntry = z.infer<typeof networkEntrySchema>;
export type ActionEvent = z.infer<typeof actionEventSchema>;
export type Device = z.infer<typeof deviceSchema>;
export type ReportLogs = z.infer<typeof reportLogsSchema>;
export type RemovedSecret = z.infer<typeof removedSecretSchema>;
export type Frame = z.infer<typeof frameSchema>;
export type PageStateData = z.infer<typeof pageStateSchema>;
export type Breakpoint = z.infer<typeof breakpointSchema>;
export type CreateReport = z.infer<typeof createReportSchema>;
export type AgentObservation = z.infer<typeof agentObservationSchema>;
export type AgentAction = z.infer<typeof agentActionSchema>;

/** One step's reply to the driver. `confirm` asks the person before a risky click runs. */
export type AgentStepResponse = {
  runId: string;
  step: number;
  action: AgentAction;
  /** The model's one-line intent for this step, shown in the live view. */
  thought?: string;
  confirm?: string;
};

/** The element line the model saw for [id], without the number: `button "Apply coupon"`. */
export function elementLabel(id: number, elements: string): string | undefined {
  return elements
    .split("\n")
    .find((l) => l.startsWith(`[${id}] `))
    ?.replace(/^\[\d+\]\s*/, "");
}

/** Why an action is never allowed (the model is told and picks another), or undefined. */
export function blockedActionReason(action: AgentAction, elements: string): string | undefined {
  if (action.type !== "type") return undefined;
  const line = elementLabel(action.id, elements);
  if (line && /\[password\]/.test(line)) return "Blocked: the agent never types into password fields. You're already signed in; choose another action or call done.";
  return undefined;
}

/** Labels that make a click need the person's OK before the agent runs it. */
const RISKY = /\b(pay|purchase|buy|checkout|place order|delete|remove|send|transfer|withdraw|confirm payment|unsubscribe|deactivate)\b/i;

/** The confirmation question for a risky action, or undefined. `elements` is the numbered list the model saw. */
export function riskyActionPrompt(action: AgentAction, elements: string): string | undefined {
  if (action.type !== "click" && !(action.type === "type" && action.submit)) return undefined;
  const line = elementLabel(action.id, elements);
  if (!line || !RISKY.test(line)) return undefined;
  return `Let the agent click ${line}?`;
}
