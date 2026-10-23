"use client";

import { CheckCircle2, Circle, XCircle } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { timeAgo } from "@/lib/utils";
import { FixPanel, type FixData, type ProjectInfo } from "@/components/fix/fix-panel";
import { AnalysisPanel, useAnalysis } from "./analysis-panel";
import { LogTabs } from "./log-tabs";
import { Player } from "./player";
import { ReportActions } from "./report-actions";
import type { ReportData, RunSummary } from "./types";

/** The report page: recording and logs on the left, the AI report on the right. Read-only on share links. */
export function ReportView({
  report,
  runs = [],
  appUrl,
  readOnly = false,
  fixing,
}: {
  report: ReportData;
  runs?: RunSummary[];
  appUrl: string;
  readOnly?: boolean;
  fixing?: { project: ProjectInfo | null; fix: FixData | null; selfHosted: boolean };
}) {
  const [time, setTime] = React.useState(0);
  const seekRef = React.useRef<((t: number) => void) | null>(null);
  const seek = React.useCallback((t: number) => seekRef.current?.(t), []);
  const analysis = useAnalysis(report, readOnly);
  const a = analysis.analysis;
  let host = report.pageUrl;
  try {
    host = new URL(report.pageUrl).host;
  } catch {}

  return (
    <div className="container-page py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="eyebrow">
            {report.kind === "video" ? "Recording" : "Screenshot"} · {host} · {timeAgo(new Date(report.createdAt))}
          </p>
          <h1 className="mt-1 text-heading font-semibold">{a?.title ?? report.title}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-ui text-ink-2">
            {a && <Badge tone={a.severity}>{a.severity}</Badge>}
            {report.note && a && report.note !== a.title && <span>Reporter: &ldquo;{report.note}&rdquo;</span>}
            <span>
              {report.device.browser} on {report.device.os}
            </span>
          </div>
        </div>
        {!readOnly && <ReportActions report={report} analysis={a} appUrl={appUrl} />}
      </div>

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <Player report={report} time={time} onTime={setTime} seekRef={seekRef} />
          <div className="mt-8">
            <LogTabs report={report} time={time} onSeek={seek} />
          </div>
        </div>
        <aside className="min-w-0">
          <AnalysisPanel state={analysis} onSeek={seek} readOnly={readOnly} />
          {!readOnly && runs.length > 0 && (
            <div className="mt-8 border-t border-hairline pt-6">
              <h3 className="text-ui font-semibold">Reproduce runs</h3>
              <ul className="mt-2">
                {runs.map((r) => (
                  <li key={r.id}>
                    <Link href={`/r/${report.id}/runs/${r.id}`} className="flex items-center gap-3 border-b border-hairline py-2.5 text-ui hover:bg-canvas-soft">
                      {r.status === "running" ? (
                        <Circle className="size-4 animate-pulse text-primary" />
                      ) : r.reproduced !== (r.purpose === "verify") && r.status === "done" ? (
                        <CheckCircle2 className="size-4 text-ok" />
                      ) : (
                        <XCircle className="size-4 text-ink-3" />
                      )}
                      <span className="flex-1">
                        {r.purpose === "verify" ? "Verify · " : ""}
                        {r.status === "running" ? "Running" : r.reproduced ? (r.purpose === "verify" ? "Still happens" : "Reproduced") : r.status === "done" ? (r.purpose === "verify" ? "Fix verified" : "Not reproduced") : r.status === "stopped" ? "Stopped" : "Failed"} · {r.steps} steps
                      </span>
                      <span className="text-caption text-ink-3">{timeAgo(new Date(r.createdAt))}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>

      {/* Fixing gets the full width: the diff and the sandbox results need the room. */}
      {!readOnly && fixing && (
        <div className="mt-12">
          <FixPanel
            report={{
              id: report.id,
              pageUrl: report.pageUrl,
              hasAnalysis: Boolean(a),
              emulation: report.device.emulated ? { width: report.device.viewport.width, height: report.device.viewport.height, scale: report.device.pixelRatio, mobile: report.device.viewport.width < 900 } : undefined,
            }}
            project={fixing.project}
            initialFix={fixing.fix}
            selfHosted={fixing.selfHosted}
          />
        </div>
      )}
    </div>
  );
}
