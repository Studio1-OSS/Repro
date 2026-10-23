export type CapturedEvent =
  | { kind: "console"; ts: number; data: { level: "log" | "info" | "warn" | "error" | "debug"; text: string; stack?: string } }
  | { kind: "network"; ts: number; data: Omit<import("./schemas").NetworkEntry, "t"> }
  | { kind: "action"; ts: number; data: { type: "click" | "input" | "key" | "navigate"; target?: string; value?: string; url?: string } };

export type PageSnapshot = { url: string; title: string; elements: string; text: string; viewport: { width: number; height: number; pixelRatio: number } };

export function installCapture(): void;
export function snapshotPage(): PageSnapshot;
export function elementCenter(id: number): { x: number; y: number } | null;
export function focusAndClear(id: number): "ok" | "missing" | "password";

export type PagePerf = {
  ttfb: number | null;
  domContentLoaded: number | null;
  load: number | null;
  lcp: number | null;
  cls: number;
  inp: number | null;
  longTasks: { start: number; duration: number }[];
  jsHeapMb: number | null;
  resources: number;
};
export type PageState = {
  perf: PagePerf;
  storage: { local: { key: string; value: string }[]; session: { key: string; value: string }[]; cookies: string[] };
  dom: string;
  domTruncated: boolean;
};
export function collectPageState(): PageState;

export type LayoutAudit = { pageWidth: number; overflowX: number; issues: { kind: string; element: string; detail: string }[] };
export function layoutAudit(): LayoutAudit;
export function selectOption(id: number, option: string): "missing" | "not-a-select" | "no-option" | `ok:${string}` | `reverted:${string}`;
export function focusedIsPassword(): boolean;
