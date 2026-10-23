// Turns the page's raw capture events into the report's logs: relative timestamps, size caps, redaction.
import type { CapturedEvent } from "./page-runtime";
import { redactLogs } from "./redact";
import { LIMITS, type ReportLogs } from "./schemas";

/**
 * Keeps events from `startTs` and caps each list, keeping the newest entries since the bug is usually at
 * the end. Console and network get a short lead-in (a request in flight when recording started);
 * user actions start exactly at Record, so nothing done before it ends up in the steps.
 */
export function buildLogs(events: CapturedEvent[], startTs: number, endTs = Infinity): ReportLogs {
  const lead = 1_000;
  const inRange = events
    .filter((e) => e.ts <= endTs && e.ts >= (e.kind === "action" ? startTs : startTs - lead))
    .sort((a, b) => a.ts - b.ts);
  const t = (ts: number) => Math.max(0, Math.round((ts - startTs) / 100) / 10);
  const logs: ReportLogs = { console: [], network: [], actions: [] };
  for (const e of inRange) {
    if (e.kind === "console") logs.console.push({ t: t(e.ts), ...e.data });
    else if (e.kind === "network") logs.network.push({ t: t(e.ts - e.data.durationMs), ...e.data });
    else logs.actions.push({ t: t(e.ts), ...e.data });
  }
  // Collapse repeated navigate events for the same URL (pushState + popstate echoes).
  logs.actions = logs.actions.filter((a, i, all) => !(a.type === "navigate" && all[i - 1]?.type === "navigate" && all[i - 1]?.url === a.url));
  logs.network.sort((a, b) => a.t - b.t);
  return redactLogs({
    console: logs.console.slice(-LIMITS.console),
    network: logs.network.slice(-LIMITS.network),
    actions: logs.actions.slice(-LIMITS.actions),
  });
}

/** Browser and OS from a user agent, for the Info tab. */
export function describeUserAgent(ua: string): { browser: string; os: string } {
  const browser =
    ua.match(/Edg\/(\d+)/)?.[1] ? `Edge ${ua.match(/Edg\/(\d+)/)![1]}` : ua.match(/Chrome\/(\d+)/)?.[1] ? `Chrome ${ua.match(/Chrome\/(\d+)/)![1]}` : ua.match(/Firefox\/(\d+)/) ? `Firefox ${ua.match(/Firefox\/(\d+)/)![1]}` : "Browser";
  const os = /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "Unknown OS";
  return { browser, os };
}
