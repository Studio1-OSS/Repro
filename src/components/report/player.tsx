"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import * as React from "react";
import { cn, formatClock } from "@/lib/utils";
import { ReplayStage } from "./elements-view";
import { ResponsiveView } from "./responsive-view";
import { isFailedRequest, reportDuration, type ReportData } from "./types";

type Marker = { t: number; kind: "step" | "error" | "request"; label: string };

/**
 * The recording (or its frames) with a timeline underneath: AI steps in blue, console errors in red,
 * failed requests in orange. Everything on the page seeks through `seek`.
 */
export function Player({ report, time, onTime, seekRef }: { report: ReportData; time: number; onTime: (t: number) => void; seekRef: React.RefObject<((t: number) => void) | null> }) {
  const video = React.useRef<HTMLVideoElement>(null);
  const duration = reportDuration(report);
  const frames = report.frames;
  const frameIndex = Math.max(0, frames.findLastIndex((f) => f.t <= time + 0.05));

  const seek = React.useCallback(
    (t: number) => {
      const clamped = Math.max(0, Math.min(t, duration));
      if (video.current) video.current.currentTime = clamped;
      onTime(clamped);
    },
    [duration, onTime],
  );
  React.useEffect(() => {
    seekRef.current = seek;
  }, [seek, seekRef]);

  const markers: Marker[] = [
    ...(report.analysis?.steps ?? []).map((s, i) => ({ t: s.t, kind: "step" as const, label: `${i + 1}. ${s.action}` })),
    ...report.logs.console.filter((c) => c.level === "error").map((c) => ({ t: c.t, kind: "error" as const, label: c.text })),
    ...report.logs.network.filter((n) => isFailedRequest(n.status)).map((n) => ({ t: n.t, kind: "request" as const, label: `${n.method} ${n.url} → ${n.status || "failed"}` })),
  ];

  if (report.kind === "responsive" && report.breakpoints?.length) {
    return <ResponsiveView breakpoints={report.breakpoints} selected={Math.min(frameIndex, report.breakpoints.length - 1)} onSelect={(i) => seek(i)} />;
  }

  return (
    <div>
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-media">
        {report.kind === "replay" && report.replayUrl ? (
          <div className="size-full overflow-auto bg-white">
            <ReplayStage url={report.replayUrl} time={time} />
          </div>
        ) : report.videoUrl ? (
          <video
            ref={video}
            src={report.videoUrl}
            controls
            playsInline
            className="size-full object-contain"
            onTimeUpdate={(e) => onTime(e.currentTarget.currentTime)}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={frames[frameIndex]?.url} alt={`Frame at ${formatClock(frames[frameIndex]?.t ?? 0)}`} className="size-full object-contain" />
        )}
        {!report.videoUrl && report.kind !== "replay" && frames.length > 1 && (
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/60 to-transparent p-3 text-ui text-white">
            <button className="grid size-8 place-items-center rounded-full bg-white/15 hover:bg-white/25" onClick={() => seek(frames[Math.max(0, frameIndex - 1)].t)} aria-label="Previous frame">
              <ChevronLeft />
            </button>
            <span>
              Frame {frameIndex + 1} of {frames.length} · {formatClock(frames[frameIndex].t)}
            </span>
            <button className="grid size-8 place-items-center rounded-full bg-white/15 hover:bg-white/25" onClick={() => seek(frames[Math.min(frames.length - 1, frameIndex + 1)].t)} aria-label="Next frame">
              <ChevronRight />
            </button>
          </div>
        )}
      </div>

      {/* Timeline */}
      <div className="mt-3">
        <div
          className="relative h-9 cursor-pointer border-b border-divider"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            seek(((e.clientX - r.left) / r.width) * duration);
          }}
        >
          <div className="absolute inset-x-0 top-1/2 h-px bg-card-border" />
          {markers.map((m, i) => (
            <span
              key={i}
              title={`${formatClock(m.t)}  ${m.label}`}
              className={cn(
                "absolute top-1/2 -translate-x-1/2 -translate-y-1/2",
                m.kind === "step" ? "size-3 rounded-full border-2 border-white bg-primary" : m.kind === "error" ? "h-4 w-[3px] bg-error" : "h-4 w-[3px] bg-warn",
              )}
              style={{ left: `${(m.t / duration) * 100}%` }}
            />
          ))}
          <span className="pointer-events-none absolute inset-y-0 w-0.5 bg-ink" style={{ left: `${Math.min(100, (time / duration) * 100)}%` }} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-ink-3">
          <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-primary" /> AI step</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-[3px] bg-error" /> Console error</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-[3px] bg-warn" /> Failed request</span>
          <span className="ml-auto">{formatClock(time)} / {formatClock(duration)}</span>
        </div>
      </div>

      {frames.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {frames.map((f, i) => (
            <button key={i} onClick={() => seek(f.t)} className={cn("relative w-28 shrink-0 border-2", i === frameIndex ? "border-primary" : "border-transparent")}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.url} alt="" className="aspect-[16/10] w-full bg-fog object-cover" loading="lazy" />
              <span className="absolute bottom-1 left-1 bg-black/70 px-1 text-[10px] text-white">{formatClock(f.t)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
