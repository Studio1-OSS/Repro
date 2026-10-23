"use client";

import { MousePointer2 } from "lucide-react";
import * as React from "react";
import type { ReportData } from "./types";

/**
 * Real DOM, so developers can right-click → Inspect it with their own browser DevTools:
 * the rrweb replay (scrubbed by the report timeline) or, for screenshots, the script-free DOM snapshot.
 */
export function ElementsView({ report, time }: { report: ReportData; time: number }) {
  return (
    <div>
      <p className="mb-3 flex items-center gap-2 text-caption text-ink-2">
        <MousePointer2 className="size-3.5 text-primary" />
        {report.replayUrl ? "This is the page's real DOM, replayed. Scrub the timeline, then right-click any element → Inspect to open it in your DevTools." : "The page's DOM when it was captured, with scripts removed. Right-click any element → Inspect to open it in your DevTools."}
      </p>
      {report.replayUrl ? <ReplayStage url={report.replayUrl} time={time} /> : <SnapshotStage url={report.pageState!.domUrl!} />}
    </div>
  );
}

/** Scales a fixed-size page (its recorded viewport) to the container width. */
function useFit(pageWidth: number) {
  const box = React.useRef<HTMLDivElement>(null);
  const [scale, setScale] = React.useState(1);
  React.useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min(1, el.clientWidth / pageWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [pageWidth]);
  return { box, scale };
}

export function ReplayStage({ url, time }: { url: string; time: number }) {
  const mount = React.useRef<HTMLDivElement>(null);
  const replayer = React.useRef<{ pause: (ms?: number) => void; destroy?: () => void } | null>(null);
  const [size, setSize] = React.useState({ width: 1280, height: 800 });
  const [error, setError] = React.useState<string | null>(null);
  const { box, scale } = useFit(size.width);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [events, { Replayer }] = await Promise.all([fetch(url).then((r) => r.json()), import("@rrweb/replay")]);
        if (cancelled || !mount.current) return;
        const meta = (events as { type: number; data: { width?: number; height?: number } }[]).find((e) => e.type === 4);
        if (meta?.data.width && meta.data.height) setSize({ width: meta.data.width, height: meta.data.height });
        mount.current.innerHTML = "";
        const r = new Replayer(events, { root: mount.current, mouseTail: false, skipInactive: false, showWarning: false, triggerFocus: false });
        r.pause(0);
        replayer.current = r as unknown as { pause: (ms?: number) => void; destroy?: () => void };
      } catch {
        if (!cancelled) setError("The replay couldn't be loaded.");
      }
    })();
    return () => {
      cancelled = true;
      replayer.current?.destroy?.();
    };
  }, [url]);

  // Follow the report timeline (debounced: seeking a replay rebuilds the DOM).
  React.useEffect(() => {
    const id = setTimeout(() => replayer.current?.pause(Math.max(0, time * 1000)), 120);
    return () => clearTimeout(id);
  }, [time]);

  if (error) return <p className="py-10 text-center text-ui text-ink-3">{error}</p>;
  return (
    <div ref={box} className="w-full overflow-hidden border border-divider bg-white" style={{ height: size.height * scale }}>
      <div ref={mount} className="repro-replay origin-top-left" style={{ width: size.width, height: size.height, transform: `scale(${scale})` }} />
    </div>
  );
}

function SnapshotStage({ url }: { url: string }) {
  const [html, setHtml] = React.useState<string | null>(null);
  const { box, scale } = useFit(1280);
  React.useEffect(() => {
    fetch(url)
      .then((r) => r.text())
      .then(setHtml, () => setHtml(""));
  }, [url]);
  return (
    <div ref={box} className="w-full overflow-hidden border border-divider bg-white" style={{ height: 800 * scale }}>
      {html === null ? (
        <p className="py-10 text-center text-ui text-ink-3">Loading the DOM snapshot…</p>
      ) : (
        // sandbox="" : no scripts, no same-origin access. Inspecting still works.
        <iframe title="DOM snapshot" sandbox="" srcDoc={html} className="origin-top-left border-0" style={{ width: 1280, height: 800, transform: `scale(${scale})` }} />
      )}
    </div>
  );
}
