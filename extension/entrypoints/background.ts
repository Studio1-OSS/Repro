// The service worker: owns captures (events from the bridge, video from the offscreen document, DOM replay
// from replay.js, page state), builds and uploads reports, pairs with the web app, runs Reproduce.
import { collectPageState, layoutAudit, type CapturedEvent, type LayoutAudit, type PageState } from "@shared/page-runtime.js";
import { buildLogs, describeUserAgent } from "@shared/logs";
import type { Breakpoint, CreateReport, Device, Frame, PageStateData } from "@shared/schemas";
import { defineBackground } from "wxt/utils/define-background";
import { startReproduce, type AgentRun, type Emulation } from "../lib/agent-driver";
import { api, dataUrlToBlob, getPairing, setPairing, upload, type Pairing } from "../lib/api";
import { DEVICES, deviceLabel, emulate, SCAN_WIDTHS } from "../lib/devices";

type Recording = { tabId: number; startTs: number; note?: string; device?: string };
export type Status = {
  pairing: Omit<Pairing, "token"> | null;
  recording: Recording | null;
  busy: string | null;
  lastError: string | null;
  lastReportUrl: string | null;
  replayOn: boolean;
};

const MAX_RECORDING_MS = 5 * 60_000;
const REPLAY_WINDOW_MS = 60_000;

export default defineBackground(() => {
  let recording: Recording | null = null;
  let events: CapturedEvent[] = [];
  let busy: string | null = null;
  let lastError: string | null = null;
  let lastReportUrl: string | null = null;
  let agent: AgentRun | null = null;
  let autoStop: ReturnType<typeof setTimeout> | undefined;
  const isAgentTab = (tabId: number | undefined) => tabId !== undefined && agent !== null && !agent.done && agent.tabId === tabId;

  const badge = (text: string, color = "#f5222d") => {
    void chrome.action.setBadgeText({ text });
    void chrome.action.setBadgeBackgroundColor({ color });
  };

  // ── Instant replay: tabs the user switched it on for (kept across service-worker restarts) ──
  const replayTabs = async () => new Set(((await chrome.storage.session.get("replayTabs")).replayTabs as number[] | undefined) ?? []);
  const injectReplay = (tabId: number) => chrome.scripting.executeScript({ target: { tabId }, files: ["/replay.js"] }).catch(() => {});
  async function setReplay(tabId: number, on: boolean) {
    const tabs = await replayTabs();
    if (on) tabs.add(tabId);
    else tabs.delete(tabId);
    await chrome.storage.session.set({ replayTabs: [...tabs] });
    if (on) await injectReplay(tabId);
  }
  chrome.tabs.onUpdated.addListener(async (tabId, info) => {
    if (info.status !== "complete") return;
    if (tabId === recording?.tabId || (await replayTabs()).has(tabId)) await injectReplay(tabId);
  });
  chrome.tabs.onRemoved.addListener((tabId) => void setReplay(tabId, false));

  async function collectReplay(tabId: number, windowMs?: number) {
    const r = (await chrome.tabs.sendMessage(tabId, { type: "replay:collect", windowMs }).catch(() => null)) as { json: string; count: number; start: number; end: number } | null;
    return r && r.count > 1 ? r : null;
  }

  async function status(tabId?: number): Promise<Status> {
    const p = await getPairing();
    return { pairing: p && { appUrl: p.appUrl, user: p.user }, recording, busy, lastError, lastReportUrl, replayOn: tabId !== undefined && (await replayTabs()).has(tabId) };
  }

  async function ensureOffscreen() {
    const existing = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
    if (existing.length) return;
    await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: [chrome.offscreen.Reason.USER_MEDIA], justification: "Record the tab you chose while you show the bug" });
  }

  async function deviceOf(tabId: number, emulated?: string): Promise<{ device: Device; pageUrl: string }> {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({ ua: navigator.userAgent, width: innerWidth, height: innerHeight, dpr: devicePixelRatio, lang: navigator.language, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, title: document.title, url: location.href }),
    });
    const d = r.result!;
    return {
      pageUrl: d.url,
      device: { userAgent: d.ua, ...describeUserAgent(d.ua), viewport: { width: d.width, height: d.height }, pixelRatio: d.dpr, language: d.lang, timezone: d.tz, pageTitle: d.title.slice(0, 300), emulated },
    };
  }

  /** Performance, storage and a DOM snapshot (uploaded as HTML). Best effort: a capture never fails on it. */
  async function pageStateOf(tabId: number, pairing: Pairing): Promise<PageStateData | undefined> {
    try {
      const [r] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: collectPageState });
      const state = r.result as PageState;
      const domUrl = await upload(new Blob([state.dom], { type: "text/html" }), "dom.html", pairing).catch(() => undefined);
      return { perf: state.perf, storage: state.storage, domUrl };
    } catch {
      return undefined;
    }
  }

  async function submit(report: CreateReport, pairing: Pairing) {
    const { url } = await api<{ id: string; url: string }>("/api/reports", { json: report, pairing });
    lastReportUrl = url;
    await chrome.tabs.create({ url });
  }

  /** Runs a capture with the busy/error bookkeeping every mode shares. */
  async function capture(label: string, fn: (pairing: Pairing) => Promise<void>) {
    busy = label;
    lastError = null;
    try {
      const pairing = await getPairing();
      if (!pairing) throw new Error("Connect the extension to Repro first.");
      await fn(pairing);
      badge("");
    } catch (e) {
      lastError = String((e as Error).message ?? e);
      badge("!", "#f5222d");
    } finally {
      busy = null;
    }
  }

  async function startRecording(tabId: number, streamId: string, note?: string, deviceId?: string) {
    if (recording) throw new Error("Already recording");
    const device = DEVICES.find((d) => d.id === deviceId);
    if (device) {
      await chrome.debugger.attach({ tabId }, "1.3");
      await emulate({ tabId }, device);
    }
    await ensureOffscreen();
    const started = (await chrome.runtime.sendMessage({ type: "offscreen:start", streamId })) as { ok: boolean; error?: string };
    if (!started.ok) {
      if (device) await chrome.debugger.detach({ tabId }).catch(() => {});
      throw new Error(started.error ?? "Couldn't start recording");
    }
    recording = { tabId, startTs: Date.now(), note, device: device && deviceLabel(device) };
    events = [];
    lastError = null;
    // What the tab already buffered (a request in flight when Record was pressed), then live forwarding.
    const lead = (await chrome.tabs.sendMessage(tabId, { type: "repro:forward", on: true }).catch(() => null)) as { events?: CapturedEvent[] } | null;
    events.push(...(lead?.events ?? []));
    await injectReplay(tabId);
    await chrome.tabs.sendMessage(tabId, { type: "replay:keep-all", keepAll: true }).catch(() => {});
    badge("REC");
    autoStop = setTimeout(() => void stopRecording(), MAX_RECORDING_MS);
  }

  async function stopRecording() {
    const r = recording;
    if (!r) return;
    clearTimeout(autoStop);
    recording = null;
    badge("…", "#0070d5");
    await capture("Uploading the recording…", async (pairing) => {
      await chrome.tabs.sendMessage(r.tabId, { type: "repro:forward", on: false }).catch(() => {});
      const stopTs = Date.now();
      const replay = await collectReplay(r.tabId);
      const [{ device, pageUrl }, pageState] = await Promise.all([deviceOf(r.tabId, r.device), pageStateOf(r.tabId, pairing)]);
      if (r.device) await chrome.debugger.detach({ tabId: r.tabId }).catch(() => {});
      await chrome.tabs.sendMessage(r.tabId, { type: "replay:keep-all", keepAll: false }).catch(() => {});
      const res = (await chrome.runtime.sendMessage({ type: "offscreen:stop", pairing })) as { ok: boolean; error?: string; media?: { videoUrl: string; durationMs: number; frames: Frame[] } };
      await chrome.offscreen.closeDocument().catch(() => {});
      if (!res.ok || !res.media) throw new Error(res.error ?? "The recording couldn't be saved");
      const replayUrl = replay ? await upload(new Blob([replay.json], { type: "application/json" }), "replay.json", pairing).catch(() => undefined) : undefined;
      await submit(
        { note: r.note, pageUrl, kind: "video", videoUrl: res.media.videoUrl, replayUrl, durationMs: res.media.durationMs, frames: res.media.frames, logs: buildLogs(events, r.startTs, stopTs), device, pageState },
        pairing,
      );
    });
    events = [];
  }

  // A screenshot is taken in two steps: capture everything now (the page may change), then upload after the
  // person has marked it up in annotate.html.
  let pendingShot: { tabId: number; pageUrl: string; device: Device; pageState?: PageStateData; events: CapturedEvent[]; at: number } | null = null;

  async function screenshot(tabId: number, windowId: number, note?: string) {
    await capture("Taking the screenshot…", async (pairing) => {
      const shot = await chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 85 });
      const recent = (await chrome.tabs.sendMessage(tabId, { type: "repro:recent" }).catch(() => null)) as { events?: CapturedEvent[] } | null;
      const [{ device, pageUrl }, pageState] = await Promise.all([deviceOf(tabId), pageStateOf(tabId, pairing)]);
      pendingShot = { tabId, pageUrl, device, pageState, events: recent?.events ?? [], at: Date.now() };
      await chrome.storage.session.set({ pendingShot: { shot, note } });
      await chrome.tabs.create({ url: chrome.runtime.getURL("/annotate.html") });
    });
  }

  async function finishScreenshot(shot: string, note?: string) {
    const p = pendingShot;
    pendingShot = null;
    await chrome.storage.session.remove("pendingShot");
    if (!p) return;
    await capture("Saving the screenshot…", async (pairing) => {
      const url = await upload(dataUrlToBlob(shot), "screenshot.jpg", pairing);
      await submit({ note, pageUrl: p.pageUrl, kind: "screenshot", frames: [{ t: 30, url }], logs: buildLogs(p.events, p.at - 30_000, p.at), device: p.device, pageState: p.pageState }, pairing);
    });
  }

  /** Instant replay: the last 30 to 60 seconds of DOM and logs, plus a screenshot of how the page looks now. */
  async function saveReplay(tabId: number, windowId: number, note?: string) {
    await capture("Saving the last 60 seconds…", async (pairing) => {
      const replay = await collectReplay(tabId, REPLAY_WINDOW_MS);
      if (!replay) throw new Error("No replay yet on this tab. Turn on instant replay, use the page, then save.");
      const shot = await chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 80 });
      const recent = (await chrome.tabs.sendMessage(tabId, { type: "repro:recent" }).catch(() => null)) as { events?: CapturedEvent[] } | null;
      const durationMs = Math.max(1000, replay.end - replay.start);
      const [{ device, pageUrl }, pageState, frameUrl, replayUrl] = await Promise.all([
        deviceOf(tabId),
        pageStateOf(tabId, pairing),
        upload(dataUrlToBlob(shot), "screenshot.jpg", pairing),
        upload(new Blob([replay.json], { type: "application/json" }), "replay.json", pairing),
      ]);
      await submit(
        { note, pageUrl, kind: "replay", replayUrl, durationMs, frames: [{ t: durationMs / 1000, url: frameUrl }], logs: buildLogs(recent?.events ?? [], replay.start, replay.end + 1000), device, pageState },
        pairing,
      );
    });
  }

  /** Responsive scan: the page at five widths, each with a screenshot and measured layout facts. */
  async function responsiveScan(tabId: number, note?: string) {
    await capture("Checking the layout at 5 sizes…", async (pairing) => {
      const target = { tabId };
      const recent = (await chrome.tabs.sendMessage(tabId, { type: "repro:recent" }).catch(() => null)) as { events?: CapturedEvent[] } | null;
      const now = Date.now();
      const [{ device, pageUrl }, pageState] = await Promise.all([deviceOf(tabId), pageStateOf(tabId, pairing)]);
      const breakpoints: Breakpoint[] = [];
      await chrome.debugger.attach(target, "1.3");
      try {
        for (const width of SCAN_WIDTHS) {
          const height = width < 768 ? 800 : 900;
          await emulate(target, { width, height, scale: 1, mobile: width < 768 });
          await new Promise((r) => setTimeout(r, 700));
          const [a] = await chrome.scripting.executeScript({ target, world: "MAIN", func: layoutAudit });
          const audit = a.result as LayoutAudit;
          const shot = (await chrome.debugger.sendCommand(target, "Page.captureScreenshot", { format: "jpeg", quality: 75, clip: { x: 0, y: 0, width, height, scale: 1 } })) as { data: string };
          const url = await upload(dataUrlToBlob(`data:image/jpeg;base64,${shot.data}`), `w${width}.jpg`, pairing);
          breakpoints.push({ width, height, url, audit });
        }
      } finally {
        await chrome.debugger.sendCommand(target, "Emulation.clearDeviceMetricsOverride").catch(() => {});
        await chrome.debugger.detach(target).catch(() => {});
      }
      await submit(
        {
          note: note || "Check the layout at phone, tablet and desktop widths",
          pageUrl,
          kind: "responsive",
          breakpoints,
          frames: breakpoints.map((b, i) => ({ t: i, url: b.url })),
          logs: buildLogs(recent?.events ?? [], now - 30_000, now),
          device,
          pageState,
        },
        pairing,
      );
    });
  }

  async function pair(appUrl: string, token: string) {
    const pairing: Pairing = { appUrl: appUrl.replace(/\/$/, ""), token };
    const me = await api<{ user: { name: string; email: string } }>("/api/me", { pairing });
    await setPairing({ ...pairing, user: me.user });
    lastError = null;
    badge("");
  }

  // Messages from the popup, the bridge and the agent banner.
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    const tabId = sender.tab?.id;
    switch (msg?.type) {
      case "repro:event": {
        const event = msg.event as CapturedEvent;
        if (recording && tabId === recording.tabId) events.push(event);
        if (isAgentTab(tabId) && event.kind === "console" && (event.data.level === "error" || event.data.level === "warn")) {
          agent!.consoleErrors.push(event.data.text.slice(0, 300));
        }
        return;
      }
      case "repro:bridge-hello":
        reply({ forward: (tabId !== undefined && tabId === recording?.tabId) || isAgentTab(tabId) });
        return;
      case "repro:status":
        void status(msg.tabId).then(reply);
        return true;
      case "repro:start":
        startRecording(msg.tabId, msg.streamId, msg.note, msg.device).then(
          () => reply({ ok: true }),
          (e) => reply({ ok: false, error: String(e?.message ?? e) }),
        );
        return true;
      case "repro:stop":
        void stopRecording();
        reply({ ok: true });
        return;
      case "repro:screenshot":
        void screenshot(msg.tabId, msg.windowId, msg.note);
        reply({ ok: true });
        return;
      case "repro:screenshot-finish":
        void finishScreenshot(msg.shot, msg.note);
        reply({ ok: true });
        return;
      case "repro:replay-toggle":
        void setReplay(msg.tabId, Boolean(msg.on)).then(() => reply({ ok: true }));
        return true;
      case "repro:replay-save":
        void saveReplay(msg.tabId, msg.windowId, msg.note);
        reply({ ok: true });
        return;
      case "repro:responsive":
        void responsiveScan(msg.tabId, msg.note);
        reply({ ok: true });
        return;
      case "repro:pair-manual": {
        // "<appUrl>#<token>", as shown on the Connect page.
        const [appUrl, token] = String(msg.value ?? "").trim().split("#");
        if (!/^https?:\/\//.test(appUrl) || !token?.startsWith("rp_")) {
          reply({ ok: false, error: "Paste the whole line from the Connect page." });
          return;
        }
        pair(appUrl, token).then(
          () => reply({ ok: true }),
          (e) => reply({ ok: false, error: String(e?.message ?? e) }),
        );
        return true;
      }
      case "repro:unpair":
        void setPairing(null).then(() => reply({ ok: true }));
        return true;
      case "repro:agent-stop":
        agent?.stop();
        return;
      case "repro:from-app": {
        const origin = sender.tab?.url ? new URL(sender.tab.url).origin : "";
        void fromApp(msg.message, origin).then(reply);
        return true;
      }
    }
  });

  /** Requests from a Repro web app page, relayed by the bridge. `origin` is the page that asked. */
  async function fromApp(msg: { type?: string; appUrl?: string; token?: string; reportId?: string; pageUrl?: string; purpose?: string; emulation?: Emulation }, origin: string) {
    const pairing = await getPairing();
    switch (msg?.type) {
      case "repro:ping":
        return { ok: true, paired: Boolean(pairing && new URL(pairing.appUrl).origin === origin) };
      case "repro:pair":
        // Pair with the app that asked. The token proves the user is signed in there: pair() checks it against that origin's /api/me.
        if (!msg.appUrl || !msg.token || new URL(msg.appUrl).origin !== origin) return { ok: false, error: "Origin mismatch" };
        return pair(msg.appUrl, msg.token).then(
          () => ({ ok: true }),
          (e) => ({ ok: false, error: String(e?.message ?? e) }),
        );
      case "repro:reproduce": {
        if (!pairing || new URL(pairing.appUrl).origin !== origin) return { error: "This extension isn't connected to this Repro app. Open Connect first." };
        if (agent && !agent.done) return { error: "A reproduce run is already going. Stop it first." };
        const run: AgentRun = { stop: () => {}, consoleErrors: [], done: false };
        agent = run;
        try {
          return { runId: await startReproduce({ reportId: String(msg.reportId), pageUrl: String(msg.pageUrl), purpose: msg.purpose === "verify" ? "verify" : "reproduce", emulation: msg.emulation }, run) };
        } catch (e) {
          return { error: String((e as Error)?.message ?? e) };
        }
      }
    }
    return { error: "Unknown request" };
  }
});
