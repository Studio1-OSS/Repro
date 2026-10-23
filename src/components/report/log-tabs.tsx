"use client";

import * as Tabs from "@radix-ui/react-tabs";
import { ChevronRight, Copy, Download, KeyRound, Search } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { cn, formatClock } from "@/lib/utils";
import { toCurl, toHar } from "@/shared/har";
import type { ConsoleEntry, NetworkEntry } from "@/shared/schemas";
import { ElementsView } from "./elements-view";
import { isFailedRequest, reportDuration, type ReportData } from "./types";

const tabClass =
  "relative -mb-px h-11 shrink-0 border-b-2 border-transparent px-1 text-ui text-ink-2 transition-colors hover:text-ink data-[state=active]:border-ink data-[state=active]:text-ink";

function Time({ t, onSeek, active }: { t: number; onSeek: (t: number) => void; active?: boolean }) {
  return (
    <button onClick={() => onSeek(t)} className={cn("w-12 shrink-0 text-left font-mono text-caption tabular-nums hover:text-primary", active ? "text-primary" : "text-ink-3")}>
      {formatClock(t)}
    </button>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="py-10 text-center text-ui text-ink-3">{children}</p>;

function Chips<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onChange(v)} className={cn("h-7 rounded-full px-3 text-caption", value === v ? "bg-ink text-white" : "bg-fog text-ink-2 hover:text-ink")}>
          {label}
        </button>
      ))}
    </div>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="flex h-8 min-w-0 flex-1 items-center gap-2 border border-card-border px-2.5 text-caption focus-within:border-primary sm:max-w-64">
      <Search className="size-3.5 shrink-0 text-ink-3" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="min-w-0 flex-1 bg-transparent outline-none" />
    </label>
  );
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The report's developer tools: console, network, actions, elements, storage, performance, info. */
export function LogTabs({ report, time, onSeek }: { report: ReportData; time: number; onSeek: (t: number) => void }) {
  const { logs, device, pageState } = report;
  const errors = logs.console.filter((c) => c.level === "error").length;
  const failed = logs.network.filter((n) => isFailedRequest(n.status)).length;
  const near = (t: number) => Math.abs(t - time) < 0.6;
  const hasElements = Boolean(report.replayUrl || pageState?.domUrl);

  return (
    <Tabs.Root defaultValue={errors ? "console" : failed ? "network" : "actions"}>
      <Tabs.List className="flex gap-6 overflow-x-auto border-b border-hairline">
        <Tabs.Trigger value="console" className={tabClass}>
          Console <span className={errors ? "text-error" : "text-ink-3"}>{errors ? `${errors} error${errors > 1 ? "s" : ""}` : logs.console.length}</span>
        </Tabs.Trigger>
        <Tabs.Trigger value="network" className={tabClass}>
          Network <span className={failed ? "text-warn" : "text-ink-3"}>{failed ? `${failed} failed` : logs.network.length}</span>
        </Tabs.Trigger>
        <Tabs.Trigger value="actions" className={tabClass}>
          Actions <span className="text-ink-3">{logs.actions.length}</span>
        </Tabs.Trigger>
        {hasElements && (
          <Tabs.Trigger value="elements" className={tabClass}>
            {report.replayUrl ? "Replay" : "Elements"}
          </Tabs.Trigger>
        )}
        {pageState && (
          <Tabs.Trigger value="performance" className={tabClass}>
            Performance
          </Tabs.Trigger>
        )}
        {pageState && (
          <Tabs.Trigger value="storage" className={tabClass}>
            Storage
          </Tabs.Trigger>
        )}
        <Tabs.Trigger value="info" className={tabClass}>
          Info
        </Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="console">
        <ConsolePanel entries={logs.console} near={near} onSeek={onSeek} />
      </Tabs.Content>
      <Tabs.Content value="network">
        <NetworkPanel report={report} near={near} onSeek={onSeek} />
      </Tabs.Content>

      <Tabs.Content value="actions" className="max-h-[460px] overflow-y-auto">
        {logs.actions.length === 0 && <Empty>No clicks or inputs were captured.</Empty>}
        {logs.actions.map((a, i) => (
          <div key={i} className={cn("flex items-start gap-3 border-b border-hairline py-2.5 text-ui", near(a.t) && "bg-canvas-soft")}>
            <Time t={a.t} onSeek={onSeek} active={near(a.t)} />
            <span className="w-20 shrink-0 capitalize text-ink-3">{a.type}</span>
            <span className="min-w-0 break-words">
              {a.type === "navigate" ? <span className="font-mono text-caption">{a.url}</span> : a.target}
              {a.value !== undefined && a.type !== "navigate" && <span className="ml-2 font-mono text-caption text-primary">{a.value}</span>}
            </span>
          </div>
        ))}
      </Tabs.Content>

      {hasElements && (
        <Tabs.Content value="elements" className="pt-4">
          <ElementsView report={report} time={time} />
        </Tabs.Content>
      )}

      {pageState && (
        <Tabs.Content value="performance" className="pt-4">
          <PerformancePanel report={report} />
        </Tabs.Content>
      )}

      {pageState && (
        <Tabs.Content value="storage" className="pt-4 text-ui">
          {(["local", "session"] as const).map((k) => (
            <div key={k} className="mb-6">
              <p className="font-semibold">{k === "local" ? "localStorage" : "sessionStorage"}</p>
              {pageState.storage[k].length === 0 ? (
                <p className="mt-1 text-caption text-ink-3">Empty</p>
              ) : (
                <table className="mt-2 w-full table-fixed text-caption">
                  <tbody>
                    {pageState.storage[k].map((e) => (
                      <tr key={e.key} className="border-b border-hairline align-top">
                        <td className="w-1/3 break-all py-1.5 pr-3 font-mono">{e.key}</td>
                        <td className="break-all py-1.5 font-mono text-ink-2">{e.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
          <p className="font-semibold">Cookies</p>
          <p className="mt-1 text-caption text-ink-2">{pageState.storage.cookies.length ? pageState.storage.cookies.join(", ") : "None readable by the page"}</p>
          <p className="mt-1 text-caption text-ink-3">Names only. Cookie values and secret-looking storage values never leave the browser.</p>
        </Tabs.Content>
      )}

      <Tabs.Content value="info" className="py-4 text-ui">
        <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2.5">
          <dt className="text-ink-3">Page</dt>
          <dd className="break-all">
            <a href={report.pageUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
              {report.pageUrl}
            </a>
          </dd>
          {device.pageTitle && (
            <>
              <dt className="text-ink-3">Page title</dt>
              <dd>{device.pageTitle}</dd>
            </>
          )}
          <dt className="text-ink-3">Browser</dt>
          <dd>
            {device.browser} on {device.os}
          </dd>
          <dt className="text-ink-3">Viewport</dt>
          <dd>
            {device.viewport.width} × {device.viewport.height} @ {device.pixelRatio}x{device.emulated ? `, emulating ${device.emulated}` : ""}
          </dd>
          <dt className="text-ink-3">Language, time zone</dt>
          <dd>
            {device.language}, {device.timezone}
          </dd>
          <dt className="text-ink-3">Captured</dt>
          <dd>{new Date(report.createdAt).toLocaleString()}</dd>
          <dt className="text-ink-3">User agent</dt>
          <dd className="break-all font-mono text-caption text-ink-2">{device.userAgent}</dd>
        </dl>
        {(logs.removedSecrets?.length ?? 0) > 0 && (
          <div className="mt-6 border border-card-border p-4">
            <p className="flex items-center gap-2 font-semibold">
              <KeyRound className="size-4 text-tier" /> Secrets removed before upload
            </p>
            <p className="mt-1 text-caption text-ink-2">The values never left the browser. Each one was still sent by the page, so it's worth fixing.</p>
            <ul className="mt-3 grid gap-1.5">
              {logs.removedSecrets!.map((s, i) => (
                <li key={i} className="flex gap-3 text-caption">
                  <Time t={s.t} onSeek={onSeek} />
                  <span>
                    <b className="font-semibold">{s.kind}</b> in {s.where}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Tabs.Content>
    </Tabs.Root>
  );
}

function ConsolePanel({ entries, near, onSeek }: { entries: ConsoleEntry[]; near: (t: number) => boolean; onSeek: (t: number) => void }) {
  const [level, setLevel] = React.useState<"all" | "error" | "warn" | "log">("all");
  const [q, setQ] = React.useState("");
  // Consecutive identical messages collapse into one row with a count, like DevTools.
  const rows = React.useMemo(() => {
    const filtered = entries.filter(
      (c) => (level === "all" || (level === "log" ? !["error", "warn"].includes(c.level) : c.level === level)) && (!q || c.text.toLowerCase().includes(q.toLowerCase())),
    );
    const out: (ConsoleEntry & { count: number })[] = [];
    for (const c of filtered) {
      const last = out.at(-1);
      if (last && last.text === c.text && last.level === c.level) last.count++;
      else out.push({ ...c, count: 1 });
    }
    return out;
  }, [entries, level, q]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 py-3">
        <Chips
          value={level}
          onChange={setLevel}
          options={[
            ["all", "All"],
            ["error", "Errors"],
            ["warn", "Warnings"],
            ["log", "Info"],
          ]}
        />
        <SearchBox value={q} onChange={setQ} placeholder="Filter messages" />
      </div>
      <div className="max-h-[460px] overflow-y-auto border-t border-hairline">
        {rows.length === 0 && <Empty>{entries.length ? "Nothing matches the filter." : "The console was quiet."}</Empty>}
        {rows.map((c, i) => (
          <div
            key={i}
            className={cn(
              "flex items-start gap-3 border-b border-hairline py-2.5",
              c.level === "error" && "bg-[#fff1f0]",
              c.level === "warn" && "bg-[#fffbe6]",
              near(c.t) && "outline outline-1 -outline-offset-1 outline-primary",
            )}
          >
            <Time t={c.t} onSeek={onSeek} active={near(c.t)} />
            <span className={cn("w-12 shrink-0 text-caption", c.level === "error" ? "text-error" : c.level === "warn" ? "text-tier" : "text-ink-3")}>{c.level}</span>
            <div className="min-w-0 flex-1 font-mono text-caption">
              <p className="whitespace-pre-wrap break-words">{c.text}</p>
              {c.stack && <p className="mt-1 whitespace-pre-wrap break-words text-ink-3">{c.stack}</p>}
            </div>
            {c.count > 1 && <span className="mr-2 shrink-0 rounded-full bg-ink-3 px-1.5 text-[11px] text-white">{c.count}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function NetworkPanel({ report, near, onSeek }: { report: ReportData; near: (t: number) => boolean; onSeek: (t: number) => void }) {
  const [filter, setFilter] = React.useState<"all" | "failed" | "fetch" | "xhr">("all");
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState<number | null>(null);
  const all = report.logs.network;
  const duration = Math.max(reportDuration(report), ...all.map((n) => n.t + n.durationMs / 1000));
  const rows = all
    .map((n, i) => ({ n, i }))
    .filter(({ n }) => (filter === "all" || (filter === "failed" ? isFailedRequest(n.status) : n.kind === filter)) && (!q || n.url.toLowerCase().includes(q.toLowerCase())));

  function exportHar() {
    const startedAt = new Date(new Date(report.createdAt).getTime() - reportDuration(report) * 1000);
    const har = toHar(all, { startedAt, pageUrl: report.pageUrl, pageTitle: report.device.pageTitle });
    download(`repro-${report.id}.har`, JSON.stringify(har, null, 2), "application/json");
    toast.success("HAR saved. Drop it into Chrome DevTools → Network to inspect it there.");
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 py-3">
        <Chips
          value={filter}
          onChange={setFilter}
          options={[
            ["all", "All"],
            ["failed", "Failed"],
            ["fetch", "Fetch"],
            ["xhr", "XHR"],
          ]}
        />
        <SearchBox value={q} onChange={setQ} placeholder="Filter URLs" />
        <button onClick={exportHar} disabled={!all.length} className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-full border border-ink px-3 text-caption hover:bg-fog disabled:opacity-40">
          <Download className="size-3.5" /> Export HAR
        </button>
      </div>
      <div className="max-h-[460px] overflow-y-auto border-t border-hairline">
        {rows.length === 0 && <Empty>{all.length ? "Nothing matches the filter." : "No fetch or XHR requests were captured."}</Empty>}
        {rows.map(({ n, i }) => {
          const bad = isFailedRequest(n.status);
          let path = n.url;
          try {
            const u = new URL(n.url);
            path = u.pathname + u.search;
          } catch {}
          const size = n.responseBody?.length;
          return (
            <div key={i} className={cn("border-b border-hairline", bad && "bg-[#fff7e6]", near(n.t) && "outline outline-1 -outline-offset-1 outline-primary")}>
              <div className="flex items-center gap-3 py-2.5">
                <Time t={n.t} onSeek={onSeek} active={near(n.t)} />
                <button onClick={() => setOpen(open === i ? null : i)} className="flex min-w-0 flex-1 items-center gap-3 text-left text-ui">
                  <ChevronRight className={cn("size-3.5 shrink-0 text-ink-3 transition-transform", open === i && "rotate-90")} />
                  <span className="w-12 shrink-0 font-mono text-caption text-ink-2">{n.method}</span>
                  <span className={cn("w-10 shrink-0 font-mono text-caption", bad ? "font-semibold text-error" : "text-ok")}>{n.status || "ERR"}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-caption">{path}</span>
                  <span className="hidden w-14 shrink-0 text-right text-caption text-ink-3 sm:inline">{size !== undefined ? (size > 1024 ? `${(size / 1024).toFixed(1)} kB` : `${size} B`) : "–"}</span>
                  <span className="hidden w-28 shrink-0 sm:block" aria-hidden>
                    <span className="relative block h-2 bg-fog">
                      <span
                        className={cn("absolute inset-y-0", bad ? "bg-warn" : "bg-primary")}
                        style={{ left: `${(n.t / duration) * 100}%`, width: `${Math.max(2, (n.durationMs / 1000 / duration) * 100)}%` }}
                      />
                    </span>
                  </span>
                  <span className="w-14 shrink-0 text-right text-caption text-ink-3">{Math.round(n.durationMs)} ms</span>
                </button>
              </div>
              {open === i && <RequestDetails n={n} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RequestDetails({ n }: { n: NetworkEntry }) {
  return (
    <div className="grid gap-3 pb-4 pl-[3.75rem] pr-2 font-mono text-caption">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 break-all text-ink-2">{n.url}</p>
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(toCurl(n));
            toast.success("Copied as cURL");
          }}
          className="inline-flex h-7 items-center gap-1.5 rounded-full border border-ink px-3 font-sans text-caption hover:bg-fog"
        >
          <Copy className="size-3.5" /> Copy as cURL
        </button>
      </div>
      {n.error && <p className="text-error">{n.error}</p>}
      <Headers title="Request headers" h={n.requestHeaders} />
      {n.requestBody && <Body title="Request payload" body={n.requestBody} />}
      <Headers title="Response headers" h={n.responseHeaders} />
      {n.responseBody && <Body title="Response" body={n.responseBody} />}
    </div>
  );
}

function Headers({ title, h }: { title: string; h: Record<string, string> }) {
  const entries = Object.entries(h);
  if (!entries.length) return null;
  return (
    <div>
      <p className="mb-1 font-sans font-semibold text-ink-2">{title}</p>
      {entries.map(([k, v]) => (
        <p key={k} className="break-all">
          <span className="text-ink-3">{k}:</span> {v}
        </p>
      ))}
    </div>
  );
}

function Body({ title, body }: { title: string; body: string }) {
  let pretty = body;
  try {
    pretty = JSON.stringify(JSON.parse(body), null, 2);
  } catch {}
  return (
    <div>
      <p className="mb-1 font-sans font-semibold text-ink-2">{title}</p>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all bg-canvas-soft p-3">{pretty}</pre>
    </div>
  );
}

function PerformancePanel({ report }: { report: ReportData }) {
  const p = report.pageState!.perf;
  // Thresholds from web.dev's Core Web Vitals.
  const grade = (v: number | null, good: number, poor: number) => (v === null ? "text-ink-3" : v <= good ? "text-ok" : v <= poor ? "text-tier" : "text-error");
  const metrics: [string, string, string][] = [
    ["LCP", p.lcp === null ? "n/a" : `${(p.lcp / 1000).toFixed(2)} s`, grade(p.lcp, 2500, 4000)],
    ["CLS", p.cls.toFixed(3), grade(p.cls, 0.1, 0.25)],
    ["INP", p.inp === null ? "n/a" : `${p.inp} ms`, grade(p.inp, 200, 500)],
    ["TTFB", p.ttfb === null ? "n/a" : `${p.ttfb} ms`, grade(p.ttfb, 800, 1800)],
    ["DOM ready", p.domContentLoaded === null ? "n/a" : `${p.domContentLoaded} ms`, "text-ink"],
    ["Load", p.load === null ? "n/a" : `${p.load} ms`, "text-ink"],
    ["JS heap", p.jsHeapMb === null ? "n/a" : `${p.jsHeapMb} MB`, "text-ink"],
    ["Resources", String(p.resources), "text-ink"],
  ];
  const longTotal = p.longTasks.reduce((a, t) => a + t.duration, 0);
  return (
    <div>
      <div className="grid grid-cols-2 gap-px bg-hairline sm:grid-cols-4">
        {metrics.map(([label, value, tone]) => (
          <div key={label} className="bg-canvas p-4">
            <p className="text-caption text-ink-3">{label}</p>
            <p className={cn("mt-1 text-subhead font-semibold", tone)}>{value}</p>
          </div>
        ))}
      </div>
      <p className="mt-6 text-ui font-semibold">
        Long tasks <span className="font-normal text-ink-3">· {p.longTasks.length} over 50 ms, {longTotal} ms blocking in total</span>
      </p>
      {p.longTasks.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {p.longTasks.map((t, i) => (
            <li key={i} className={cn("rounded-full px-2.5 py-0.5 font-mono text-caption", t.duration > 200 ? "bg-[#fff1f0] text-error" : "bg-fog text-ink-2")}>
              {t.duration} ms at {(t.start / 1000).toFixed(1)} s
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-caption text-ink-3">Measured in the page with the Performance API, from page load to capture. Thresholds follow Core Web Vitals.</p>
    </div>
  );
}
