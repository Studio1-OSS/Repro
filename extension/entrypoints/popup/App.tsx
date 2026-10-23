import { useEffect, useState } from "react";
import type { Status } from "../background";
import { DEFAULT_APP_URL } from "../../lib/api";
import { DEVICES } from "../../lib/devices";

const send = <T,>(msg: object) => chrome.runtime.sendMessage(msg) as Promise<T>;
const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

export function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [tab, setTab] = useState<chrome.tabs.Tab | null>(null);
  const [note, setNote] = useState("");
  const [paste, setPaste] = useState("");
  const [device, setDevice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let tabId: number | undefined;
    const refresh = () => send<Status>({ type: "repro:status", tabId }).then(setStatus);
    // popup.html?tab=<id> targets a specific tab (the e2e test and the demo recorder open the popup as a page).
    const forced = Number(new URLSearchParams(location.search).get("tab"));
    (forced ? chrome.tabs.get(forced).then((t) => [t]) : chrome.tabs.query({ active: true, currentWindow: true })).then(([t]) => {
      setTab(t ?? null);
      tabId = t?.id;
      void refresh();
    });
    const timer = setInterval(() => {
      setNow(Date.now());
      void refresh();
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const appUrl = status?.pairing?.appUrl ?? DEFAULT_APP_URL;
  const recordable = Boolean(tab?.id && tab.url && /^https?:/.test(tab.url));

  async function record() {
    setError(null);
    try {
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab!.id! });
      const r = await send<{ ok: boolean; error?: string }>({ type: "repro:start", tabId: tab!.id, streamId, note: note.trim() || undefined, device: device || undefined });
      if (!r.ok) setError(r.error ?? "Couldn't start recording");
      else window.close();
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  }

  if (!status) return <div className="p-5 text-sm text-ink-3">Loading…</div>;

  return (
    <div className="p-5">
      <header className="flex items-center gap-2">
        <svg viewBox="0 0 32 32" className="size-6" aria-hidden>
          <rect x="1" y="1" width="30" height="30" rx="8" fill="#0070d5" />
          <path d="M23.9 10.6A9.2 9.2 0 1 0 25.2 16" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" />
          <path d="M25.3 6.4v4.9h-4.9" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M13.2 10.4v10.8l2.7-2.5 1.9 4 1.9-.9-1.9-3.9h3.7z" fill="#fff" />
        </svg>
        <span className="text-[17px] font-semibold tracking-[-0.03em]">Repro</span>
        {status.pairing?.user && <span className="ml-auto truncate text-xs text-ink-3">{status.pairing.user.email}</span>}
      </header>

      {!status.pairing ? (
        <div className="mt-5">
          <p className="text-sm text-ink-2">Connect this extension to your Repro account to start recording bugs.</p>
          <button className="mt-4 h-10 w-full rounded-full bg-primary text-sm text-white hover:bg-[#0060ef]" onClick={() => chrome.tabs.create({ url: `${appUrl}/connect` })}>
            Connect to Repro
          </button>
          <details className="mt-4 text-xs text-ink-2">
            <summary className="cursor-pointer">Paste a token instead</summary>
            <input value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="http://localhost:3000#rp_…" className="mt-2 h-9 w-full border border-line px-2 font-mono text-xs outline-none focus:border-primary" />
            <button
              className="mt-2 h-8 w-full rounded-full border border-ink text-xs"
              onClick={async () => {
                const r = await send<{ ok: boolean; error?: string }>({ type: "repro:pair-manual", value: paste });
                if (!r.ok) setError(r.error ?? "Couldn't connect");
                else setStatus(await send<Status>({ type: "repro:status" }));
              }}
            >
              Connect
            </button>
          </details>
        </div>
      ) : status.recording ? (
        <div className="mt-5 text-center">
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-rec">
            <span className="size-2 animate-pulse rounded-full bg-rec" /> Recording {clock(now - status.recording.startTs)}
          </p>
          <p className="mt-1 text-xs text-ink-3">Show the bug, then stop. Console, network and clicks are captured too.</p>
          <button className="mt-4 h-11 w-full rounded-full bg-ink text-sm text-white hover:bg-black" onClick={() => send({ type: "repro:stop" }).then(() => window.close())}>
            Stop and create report
          </button>
        </div>
      ) : status.busy ? (
        <p className="mt-6 text-center text-sm text-ink-2">{status.busy}</p>
      ) : (
        <div className="mt-4">
          <label className="text-xs text-ink-2" htmlFor="note">
            What went wrong? <span className="text-ink-3">(helps the AI)</span>
          </label>
          <textarea
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder="e.g. The total shows NaN after applying a coupon"
            className="mt-1 w-full resize-none border border-line p-2 text-sm outline-none focus:border-primary"
          />
          {recordable ? (
            <div className="mt-3 grid gap-2">
              <div className="flex gap-2">
                <button className="flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-primary text-sm text-white hover:bg-[#0060ef]" onClick={record}>
                  <span className="size-2.5 rounded-full bg-white" /> Record this tab
                </button>
                <select
                  value={device}
                  onChange={(e) => setDevice(e.target.value)}
                  title="Record at a device size"
                  className="h-11 w-[104px] rounded-full border border-line bg-white px-2 text-xs outline-none focus:border-primary"
                >
                  <option value="">As is</option>
                  {DEVICES.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>
              {device && <p className="text-[11px] text-ink-3">The tab switches to {DEVICES.find((d) => d.id === device)?.label} size while recording; Chrome shows a debugging banner for that.</p>}
              <button
                className="h-10 rounded-full border border-ink text-sm hover:bg-fog"
                onClick={() => send({ type: "repro:screenshot", tabId: tab!.id, windowId: tab!.windowId, note: note.trim() || undefined }).then(() => window.close())}
              >
                Screenshot with the last 30 s of logs
              </button>
              <button
                className="h-10 rounded-full border border-ink text-sm hover:bg-fog"
                onClick={() => send({ type: "repro:responsive", tabId: tab!.id, note: note.trim() || undefined }).then(() => window.close())}
              >
                Check the layout at 5 screen sizes
              </button>
              <div className="mt-1 flex items-center gap-2 border-t border-line pt-3">
                <label className="flex flex-1 cursor-pointer items-center gap-2 text-xs text-ink-2">
                  <input
                    type="checkbox"
                    checked={status.replayOn}
                    onChange={(e) => send({ type: "repro:replay-toggle", tabId: tab!.id, on: e.target.checked }).then(() => send<Status>({ type: "repro:status", tabId: tab!.id }).then(setStatus))}
                    className="accent-primary"
                  />
                  Instant replay on this tab
                </label>
                <button
                  disabled={!status.replayOn}
                  className="h-8 rounded-full bg-ink px-3 text-xs text-white disabled:opacity-30"
                  onClick={() => send({ type: "repro:replay-save", tabId: tab!.id, windowId: tab!.windowId, note: note.trim() || undefined }).then(() => window.close())}
                >
                  Save last 60 s
                </button>
              </div>
              {status.replayOn && <p className="text-[11px] text-ink-3">Keeps the last minute of this page's DOM, in the tab only, until you save it.</p>}
            </div>
          ) : (
            <p className="mt-3 bg-soft p-3 text-xs text-ink-2">Repro can record normal web pages (http and https), not browser pages like this one.</p>
          )}
        </div>
      )}

      {(error || status.lastError) && <p className="mt-4 bg-[#fff1f0] px-3 py-2 text-xs text-rec">{error ?? status.lastError}</p>}

      <footer className="mt-5 flex items-center justify-between border-t border-line pt-3 text-xs">
        <button className="text-primary hover:underline" onClick={() => chrome.tabs.create({ url: `${appUrl}/dashboard` })}>
          Your reports ›
        </button>
        {status.pairing && (
          <button className="text-ink-3 hover:text-ink" onClick={() => send({ type: "repro:unpair" }).then(() => send<Status>({ type: "repro:status" }).then(setStatus))}>
            Disconnect
          </button>
        )}
      </footer>
    </div>
  );
}
