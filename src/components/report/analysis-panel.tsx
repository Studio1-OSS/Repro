"use client";

import { AlertTriangle, RotateCcw, ShieldAlert, Sparkles } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { site } from "@/config/site";
import { formatClock } from "@/lib/utils";
import type { Analysis } from "@/shared/schemas";
import type { ReportData } from "./types";

type State = { phase: "idle" | "thinking" | "done" | "error"; reasoning: string; analysis: Analysis | null; error?: string };

/** Starts the analysis on first view and streams the model's reasoning while it works. */
export function useAnalysis(report: ReportData, readOnly: boolean) {
  const [state, setState] = React.useState<State>({ phase: report.analysis ? "done" : "idle", reasoning: "", analysis: report.analysis, error: report.analysisError ?? undefined });

  const run = React.useCallback(async () => {
    setState({ phase: "thinking", reasoning: "", analysis: null });
    try {
      const res = await fetch(`/api/reports/${report.id}/analyze`, { method: "POST" });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        setState((s) => ({ ...s, phase: "error", error: body.error ?? `The analysis failed (${res.status})` }));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines.filter(Boolean)) {
          const msg = JSON.parse(line) as { type: "reasoning"; text: string } | { type: "done"; analysis: Analysis } | { type: "error"; message: string };
          if (msg.type === "reasoning") setState((s) => ({ ...s, reasoning: s.reasoning + msg.text }));
          else if (msg.type === "done") setState((s) => ({ ...s, phase: "done", analysis: msg.analysis }));
          else setState((s) => ({ ...s, phase: "error", error: msg.message }));
        }
      }
      if (buffer.trim()) {
        const msg = JSON.parse(buffer);
        if (msg.type === "done") setState((s) => ({ ...s, phase: "done", analysis: msg.analysis }));
      }
    } catch {
      setState((s) => ({ ...s, phase: "error", error: "Lost the connection while analysing. Try again." }));
    }
  }, [report.id]);

  const started = React.useRef(false);
  React.useEffect(() => {
    if (readOnly || started.current || report.analysis || report.status === "failed") return;
    started.current = true;
    void run();
  }, [readOnly, report.analysis, report.status, run]);

  return { ...state, retry: run };
}

export function AnalysisPanel({ state, onSeek, readOnly }: { state: ReturnType<typeof useAnalysis>; onSeek: (t: number) => void; readOnly: boolean }) {
  const thinkingBox = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    thinkingBox.current?.scrollTo({ top: thinkingBox.current.scrollHeight });
  }, [state.reasoning]);

  if (state.phase === "thinking" || state.phase === "idle") {
    return (
      <section className="bg-canvas-soft p-6">
        <p className="eyebrow flex items-center gap-1.5">
          <Sparkles className="size-3.5" /> {site.model.name} is reading the recording
        </p>
        <p className="mt-2 text-subhead font-semibold">Writing the report…</p>
        <p className="mt-1 text-ui text-ink-2">Frames, clicks, console and network go to the model in one call. This usually takes 5 to 15 seconds.</p>
        <div ref={thinkingBox} className="mt-4 max-h-56 overflow-y-auto border-l-2 border-primary pl-3 font-mono text-caption leading-relaxed text-ink-2">
          {state.reasoning || <span className="animate-pulse">Thinking…</span>}
        </div>
      </section>
    );
  }
  if (state.phase === "error" || !state.analysis) {
    return (
      <section className="border border-card-border p-6">
        <p className="flex items-center gap-2 font-semibold text-error">
          <AlertTriangle className="size-4" /> No AI report yet
        </p>
        <p className="mt-1 text-ui text-ink-2">{state.error ?? "The analysis hasn't run."}</p>
        {!readOnly && (
          <Button variant="outline" size="sm" className="mt-4" onClick={state.retry}>
            <RotateCcw /> Try again
          </Button>
        )}
      </section>
    );
  }

  const a = { ...state.analysis, layout: state.analysis.layout ?? [] };
  return (
    <section className="grid gap-6">
      <div>
        <p className="eyebrow flex items-center gap-1.5">
          <Sparkles className="size-3.5" /> AI report by {site.model.name}
        </p>
        <p className="mt-2 text-body">{a.summary}</p>
      </div>

      <div>
        <h3 className="text-ui font-semibold">Steps to reproduce</h3>
        <ol className="mt-2 grid gap-1">
          {a.steps.length === 0 && <li className="text-ui text-ink-3">No steps: this capture shows a state, not a sequence.</li>}
          {a.steps.map((s, i) => (
            <li key={i}>
              <button onClick={() => onSeek(s.t)} className="group flex w-full gap-3 py-1.5 text-left text-ui hover:bg-canvas-soft">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-caption font-semibold text-white">{i + 1}</span>
                <span className="flex-1">{s.action}</span>
                <span className="shrink-0 font-mono text-caption text-ink-3 group-hover:text-primary">{formatClock(s.t)}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="bg-[#ecf8ef] p-4">
          <p className="text-caption font-semibold text-ok">Expected</p>
          <p className="mt-1 text-ui">{a.expected}</p>
        </div>
        <div className="bg-[#fff1f0] p-4">
          <p className="text-caption font-semibold text-error">Actual</p>
          <p className="mt-1 text-ui">{a.actual}</p>
        </div>
      </div>

      <div>
        <h3 className="text-ui font-semibold">Likely cause</h3>
        <p className="mt-1 text-ui text-ink">{a.suspectedCause}</p>
        {a.evidence.length > 0 && (
          <ul className="mt-3 grid gap-1.5">
            {a.evidence.map((e, i) => (
              <li key={i} className="break-words bg-canvas-soft px-3 py-2 font-mono text-caption text-ink-2">
                {e}
              </li>
            ))}
          </ul>
        )}
      </div>

      {a.layout.length > 0 && (
        <div>
          <h3 className="text-ui font-semibold">Layout problems</h3>
          <ul className="mt-2 grid gap-3">
            {a.layout.map((l, i) => (
              <li key={i} className="border-l-2 border-tier pl-3 text-ui">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={l.severity === "high" ? "high" : l.severity === "medium" ? "medium" : "low"}>{l.severity}</Badge>
                  <span className="font-semibold">{l.width}px</span>
                  <span className="text-ink-2">{l.element}</span>
                </div>
                <p className="mt-1">{l.issue}</p>
                <p className="mt-1 font-mono text-caption text-ink-2">{l.suggestion}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {a.security.length > 0 && (
        <div className="border border-[#ffccc7] p-4">
          <p className="flex items-center gap-2 text-ui font-semibold">
            <ShieldAlert className="size-4 text-error" /> Security findings
          </p>
          <ul className="mt-3 grid gap-3">
            {a.security.map((s, i) => (
              <li key={i} className="text-ui">
                <div className="flex items-start gap-2">
                  <Badge tone={s.severity === "high" ? "high" : s.severity === "medium" ? "medium" : "low"}>{s.severity}</Badge>
                  <span className="font-semibold">{s.issue}</span>
                </div>
                <p className="mt-1 break-words text-caption text-ink-2">{s.evidence}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
