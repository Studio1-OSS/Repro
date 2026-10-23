"use client";

import { CheckCircle2, Globe, Loader2, MousePointerClick, Square, XCircle } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { site } from "@/config/site";
import { cn } from "@/lib/utils";
import type { AgentAction } from "@/shared/schemas";

type Event = { seq: number; kind: "observation" | "action" | "done" | "error"; payload: Record<string, unknown>; screenshotUrl: string | null };
type End = { status: string; reproduced: boolean | null; summary: string | null; steps: number; inputTokens: number; outputTokens: number };

function describe(action: AgentAction, target?: string): string {
  switch (action.type) {
    case "click":
      return `Click ${target ?? `element ${action.id}`}`;
    case "select":
      return `Choose "${action.option}" in ${target ?? `element ${action.id}`}`;
    case "click_at":
      return `Click at (${Math.round(action.x)}, ${Math.round(action.y)})`;
    case "type":
      return `Type "${action.text}" into ${target ?? `element ${action.id}`}${action.submit ? " and press Enter" : ""}`;
    case "press":
      return `Press ${action.key}`;
    case "scroll":
      return `Scroll ${action.direction}`;
    case "navigate":
      return `Open ${action.url}`;
    case "wait":
      return `Wait ${action.ms} ms`;
    case "done":
      return action.reproduced ? "Reproduced" : "Not reproduced";
    case "give_up":
      return `Stopped: ${action.reason}`;
  }
}

/** Follows a reproduce run as the extension drives it: the latest screenshot and every step. */
export function LiveRun({ runId, reportId, reportTitle, initialStatus, purpose = "reproduce" }: { runId: string; reportId: string; reportTitle: string; initialStatus: string; purpose?: "reproduce" | "verify" }) {
  const verify = purpose === "verify";
  const [events, setEvents] = React.useState<Event[]>([]);
  const [end, setEnd] = React.useState<End | null>(null);
  const [stopping, setStopping] = React.useState(false);

  React.useEffect(() => {
    const source = new EventSource(`/api/agent/${runId}/events`);
    source.addEventListener("step", (e) => {
      const ev = JSON.parse((e as MessageEvent).data) as Event;
      setEvents((list) => (list.some((x) => x.seq === ev.seq) ? list : [...list, ev]));
    });
    source.addEventListener("end", (e) => {
      setEnd(JSON.parse((e as MessageEvent).data) as End);
      source.close();
    });
    return () => source.close();
  }, [runId]);

  const shots = events.filter((e) => e.kind === "observation" && e.screenshotUrl);
  const latest = shots.at(-1);
  const latestUrl = (latest?.payload.url as string | undefined) ?? "";
  const running = !end && initialStatus === "running";
  const steps = events.filter((e) => e.kind !== "observation");

  return (
    <div className="container-page py-8">
      <Link href={`/r/${reportId}`} className="text-ui text-primary hover:underline">
        ‹ {reportTitle}
      </Link>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{verify ? "Verify the fix" : "Reproduce run"} · {site.model.name} driving your browser</p>
          <h1 className="mt-1 text-heading font-semibold">
            {end
              ? end.status === "done"
                ? verify
                  ? end.reproduced
                    ? "Still happens"
                    : "Fix verified"
                  : end.reproduced
                    ? "Reproduced"
                    : "Not reproduced"
                : end.status === "stopped"
                  ? "Stopped"
                  : "Run failed"
              : verify
                ? "Checking the fix…"
                : "Reproducing…"}
          </h1>
        </div>
        {running && (
          <Button
            variant="danger"
            size="sm"
            loading={stopping}
            onClick={async () => {
              setStopping(true);
              const res = await fetch(`/api/agent/${runId}/stop`, { method: "POST" });
              if (!res.ok) toast.error("Couldn't stop the run");
            }}
          >
            {!stopping && <Square />} Stop
          </Button>
        )}
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <div className="border border-divider">
            <div className="flex h-10 items-center gap-2 border-b border-divider bg-announce px-3 text-caption text-ink-2">
              <span className="flex gap-1.5">
                <span className="size-2.5 rounded-full bg-[#ff5f57]" />
                <span className="size-2.5 rounded-full bg-[#febc2e]" />
                <span className="size-2.5 rounded-full bg-[#28c840]" />
              </span>
              <span className="ml-2 flex min-w-0 flex-1 items-center gap-1.5 rounded-full bg-canvas px-3 py-1">
                <Globe className="size-3 shrink-0" />
                <span className="truncate">{latestUrl || "Waiting for the first screenshot…"}</span>
              </span>
              {running && <span className="inline-flex items-center gap-1 text-primary"><span className="size-2 animate-pulse rounded-full bg-primary" /> Live</span>}
            </div>
            <div className="relative aspect-[16/10] bg-media">
              {latest?.screenshotUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={latest.screenshotUrl} alt="What the agent sees" className="size-full object-contain" />
              ) : (
                <div className="grid size-full place-items-center text-ui text-white/60">
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" /> Waiting for the extension to open a tab…
                  </span>
                </div>
              )}
            </div>
          </div>
          {shots.length > 1 && (
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {shots.map((s, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={s.seq} src={s.screenshotUrl!} alt={`Step ${i + 1}`} className={cn("aspect-[16/10] w-24 shrink-0 border-2 object-cover", s === latest ? "border-primary" : "border-transparent")} />
              ))}
            </div>
          )}
        </div>

        <aside className="min-w-0">
          {end && (
            <div className={cn("mb-6 p-5", end.status === "done" && end.reproduced !== verify ? "bg-[#ecf8ef]" : "bg-canvas-soft")}>
              <p className="flex items-center gap-2 font-semibold">
                {end.status === "done" && end.reproduced !== verify ? <CheckCircle2 className="size-5 text-ok" /> : <XCircle className="size-5 text-ink-3" />}
                {end.status !== "done" ? end.summary : verify ? (end.reproduced ? "The bug still happens after the fix" : "The fix works: the bug is gone in your browser") : end.reproduced ? "The bug reproduced in your browser" : "The bug didn't happen"}
              </p>
              {end.summary && end.status === "done" && <p className="mt-2 text-ui text-ink-2">{end.summary}</p>}
              <p className="mt-3 text-caption text-ink-3">
                {end.steps} steps · {end.inputTokens.toLocaleString()} input / {end.outputTokens.toLocaleString()} output tokens
              </p>
            </div>
          )}
          <h2 className="text-ui font-semibold">Steps</h2>
          <ol className="mt-2">
            {steps.length === 0 && <li className="py-6 text-ui text-ink-3">The first step appears here as soon as the extension sends a screenshot.</li>}
            {steps.map((e, i) => {
              const action = (e.kind === "done" ? e.payload : e.payload.action) as AgentAction | undefined;
              return (
                <li key={e.seq} className="flex gap-3 border-b border-hairline py-3">
                  <span className={cn("grid size-6 shrink-0 place-items-center rounded-full text-caption font-semibold", e.kind === "error" ? "bg-[#fff1f0] text-error" : e.kind === "done" ? "bg-ink text-white" : "bg-primary-tint text-primary-strong")}>
                    {e.kind === "action" ? i + 1 : e.kind === "done" ? "✓" : "!"}
                  </span>
                  <div className="min-w-0 text-ui">
                    {e.kind === "error" ? (
                      <p className="text-error">{String(e.payload.message)}</p>
                    ) : (
                      <>
                        <p className="flex items-center gap-1.5 font-semibold">
                          {e.kind === "action" && <MousePointerClick className="size-3.5 text-ink-3" />}
                          {action ? describe(action, e.payload.target as string | undefined) : ""}
                        </p>
                        {typeof e.payload.thought === "string" && <p className="mt-0.5 text-caption text-ink-2">{e.payload.thought}</p>}
                        {e.kind === "done" && typeof e.payload.evidence === "string" && <p className="mt-1 text-caption text-ink-2">{e.payload.evidence}</p>}
                        {typeof e.payload.confirm === "string" && <p className="mt-1 text-caption text-tier">Asked you first: {e.payload.confirm}</p>}
                      </>
                    )}
                  </div>
                </li>
              );
            })}
            {running && (
              <li className="flex items-center gap-2 py-3 text-ui text-ink-3">
                <Loader2 className="size-4 animate-spin" /> Thinking about the next step…
              </li>
            )}
          </ol>
        </aside>
      </div>
    </div>
  );
}
