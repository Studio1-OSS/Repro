import { describe, expect, it } from "vitest";
import { blockedActionReason, riskyActionPrompt, type ReportLogs } from "@/shared/schemas";
import { goalMessage, parseAction, startHistory, trimScreenshots } from "./agent";
import { buildAnalysisContent, formatLogs } from "./analyze";
import { cleanModelJson, reasoningOf, type Message } from "./nebius";

const logs: ReportLogs = {
  actions: [{ t: 0.8, type: "input", target: 'input "Coupon"', value: "SAVE10" }],
  console: [{ t: 1.4, level: "error", text: "TypeError: Cannot read properties of undefined (reading 'rate')", stack: "at checkout:12:31" }],
  network: [
    {
      t: 1.3,
      kind: "fetch",
      method: "GET",
      url: "https://shop.test/api/coupons/SAVE10",
      status: 200,
      durationMs: 41.6,
      requestHeaders: { accept: "*/*", "x-client": "web" },
      responseHeaders: {},
      responseBody: '{"percent_off":10}',
    },
  ],
};
const device = { userAgent: "UA", browser: "Chrome 141", os: "macOS", viewport: { width: 1280, height: 800 }, pixelRatio: 2, language: "en-US", timezone: "UTC" };

describe("formatLogs", () => {
  it("writes one compact line per event and drops noisy headers", () => {
    const text = formatLogs(logs);
    expect(text).toContain('[0.8s] input input "Coupon" = "SAVE10"');
    expect(text).toContain("[1.4s] error: TypeError");
    expect(text).toContain("[1.3s] GET https://shop.test/api/coupons/SAVE10 → 200 42ms");
    expect(text).toContain("request headers: x-client: web");
    expect(text).not.toContain("accept:");
    expect(text).toContain('response: {"percent_off":10}');
  });
});

describe("buildAnalysisContent", () => {
  const frames = Array.from({ length: 6 }, (_, i) => ({ t: i, url: `data:image/jpeg;base64,${i}` }));

  it("sends the last three frames at full detail and the rest at low detail", () => {
    const content = buildAnalysisContent({ pageUrl: "https://shop.test", device, frames, logs, durationMs: 6000 });
    const details = content.flatMap((p) => (p.type === "image_url" ? [p.image_url.detail] : []));
    expect(details).toEqual(["low", "low", "low", "high", "high", "high"]);
  });

  it("sends one video part instead of frames when video input is on", () => {
    const content = buildAnalysisContent({ pageUrl: "https://shop.test", device, frames, logs, videoUrl: "https://cdn/x.webm" }, { videoInput: true });
    expect(content.some((p) => (p as { type: string }).type === "video_url")).toBe(true);
    expect(content.some((p) => p.type === "image_url")).toBe(false);
  });
});

describe("agent", () => {
  it("parses tool calls and JSON text into validated actions", () => {
    expect(parseAction("click", '{"id": 7}')).toEqual({ type: "click", id: 7 });
    expect(parseAction(undefined, '{"type":"done","reproduced":true,"evidence":"Total $NaN"}')).toEqual({ type: "done", reproduced: true, evidence: "Total $NaN" });
    expect(parseAction("click", '{"id": "seven"}')).toBeNull();
    expect(parseAction("teleport", "{}")).toBeNull();
    expect(parseAction("give_up", '{"reason":"sign-in page"}')).toEqual({ type: "give_up", reason: "sign-in page" });
    expect(parseAction("click", "not json")).toBeNull();
  });

  it("keeps only the newest screenshots in the prompt", () => {
    const shot = (n: number): Message => ({ role: "user", content: [{ type: "text", text: `obs ${n}` }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${n}` } }] });
    const trimmed = trimScreenshots([...startHistory({ pageUrl: "https://x", title: "t" }), shot(1), shot(2), shot(3)]);
    const images = trimmed.flatMap((m) => (Array.isArray(m.content) ? m.content.filter((p) => p.type === "image_url") : []));
    expect(images).toHaveLength(2);
    expect(JSON.stringify(trimmed[2])).toContain("older screenshot removed");
  });

  it("builds the goal from the analysis, or from the action log when there's none", () => {
    const analysis = { title: "Coupon makes total NaN", summary: "", severity: "high" as const, steps: [{ t: 1, action: "Apply SAVE10" }], expected: "$129.60", actual: "$NaN", suspectedCause: "", evidence: [], security: [], layout: [] };
    expect(goalMessage({ pageUrl: "https://shop.test", title: "x", analysis })).toContain("1. Apply SAVE10");
    expect(goalMessage({ pageUrl: "https://shop.test", title: "x", logs })).toContain('input input "Coupon" = "SAVE10"');
  });

  it("never types into password fields", () => {
    const elements = '[6] input[email] "Email"\n[7] input[password] "Password"';
    expect(blockedActionReason({ type: "type", id: 7, text: "hunter22" }, elements)).toMatch(/password/);
    expect(blockedActionReason({ type: "type", id: 6, text: "a@b.co" }, elements)).toBeUndefined();
    expect(blockedActionReason({ type: "click", id: 7 }, elements)).toBeUndefined();
  });

  it("asks before risky clicks only", () => {
    const elements = '[1] input "Coupon"\n[2] button "Apply coupon"\n[3] button "Place order"\n[4] button "Delete account"';
    expect(riskyActionPrompt({ type: "click", id: 2 }, elements)).toBeUndefined();
    expect(riskyActionPrompt({ type: "click", id: 3 }, elements)).toBe('Let the agent click button "Place order"?');
    expect(riskyActionPrompt({ type: "click", id: 4 }, elements)).toContain("Delete account");
    expect(riskyActionPrompt({ type: "type", id: 1, text: "x" }, elements)).toBeUndefined();
  });
});

describe("nebius helpers", () => {
  it("finds reasoning in any of the fields providers use", () => {
    expect(reasoningOf({ reasoning_content: "a" })).toBe("a");
    expect(reasoningOf({ reasoning: "b" })).toBe("b");
    expect(reasoningOf({ content: "<think>c</think>{}" })).toBe("c");
  });

  it("pulls the JSON object out of a reply", () => {
    expect(cleanModelJson('<think>{maybe}</think>\n```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
});
