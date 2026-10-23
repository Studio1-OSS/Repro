"use client";

import { cn } from "@/lib/utils";
import type { Breakpoint } from "@/shared/schemas";

/** A responsive scan: one column per width, with what the page measured at that size. */
export function ResponsiveView({ breakpoints, selected, onSelect }: { breakpoints: Breakpoint[]; selected: number; onSelect: (i: number) => void }) {
  const b = breakpoints[selected];
  return (
    <div>
      <div className="flex gap-2 overflow-x-auto pb-2">
        {breakpoints.map((bp, i) => (
          <button
            key={bp.width}
            onClick={() => onSelect(i)}
            className={cn("h-9 shrink-0 rounded-full px-4 text-ui", i === selected ? "bg-ink text-white" : "bg-fog text-ink-2 hover:text-ink")}
          >
            {bp.width}px
            {bp.audit.issues.length > 0 && <span className={cn("ml-1.5 rounded-full px-1.5 text-caption", i === selected ? "bg-white/20" : "bg-[#fff1f0] text-error")}>{bp.audit.issues.length}</span>}
          </button>
        ))}
      </div>
      <div className="flex justify-center bg-fog p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={b.url} alt={`The page at ${b.width}px wide`} className="max-h-[620px] w-auto border border-divider bg-white" style={{ maxWidth: Math.min(100, (b.width / 1440) * 100 + 20) + "%" }} />
      </div>
      <div className="mt-3 text-ui">
        <p className="font-semibold">
          {b.width}×{b.height}px · page {b.audit.pageWidth}px wide
          {b.audit.overflowX > 0 && <span className="ml-2 text-error">{b.audit.overflowX}px horizontal scroll</span>}
        </p>
        {b.audit.issues.length === 0 ? (
          <p className="mt-1 text-ink-3">No layout problems measured at this width.</p>
        ) : (
          <ul className="mt-2 grid gap-1">
            {b.audit.issues.map((i, k) => (
              <li key={k} className="flex gap-3 border-b border-hairline py-1.5 text-caption">
                <span className="w-32 shrink-0 text-tier">{i.kind.replace(/-/g, " ")}</span>
                <span className="min-w-0 flex-1 break-words font-mono">{i.element}</span>
                <span className="shrink-0 text-ink-3">{i.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
