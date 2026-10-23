// Drives a reproduce run in the user's own browser. The app's /api/agent/step picks each action; this file
// observes the tab (CDP screenshot + numbered element list) and performs the action with real input events
// through chrome.debugger. The agent only ever touches the window it opened, and stays on the report's site.
import { elementCenter, focusAndClear, focusedIsPassword, selectOption, snapshotPage, type PageSnapshot } from "@shared/page-runtime.js";
import type { AgentAction, AgentObservation, AgentStepResponse } from "@shared/schemas";
import { api, ApiError } from "./api";
import { emulate } from "./devices";

/** Device size to reproduce at: the one the bug was recorded with. */
export type Emulation = { width: number; height: number; scale: number; mobile: boolean };

type Target = { tabId: number };

const KEYS: Record<string, { code: string; keyCode: number }> = {
  Enter: { code: "Enter", keyCode: 13 },
  Escape: { code: "Escape", keyCode: 27 },
  Tab: { code: "Tab", keyCode: 9 },
  Backspace: { code: "Backspace", keyCode: 8 },
  ArrowDown: { code: "ArrowDown", keyCode: 40 },
  ArrowUp: { code: "ArrowUp", keyCode: 38 },
  ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { code: "ArrowRight", keyCode: 39 },
  Space: { code: "Space", keyCode: 32 },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cdp = <T = unknown>(t: Target, method: string, params?: object) => chrome.debugger.sendCommand(t, method, params) as Promise<T>;

async function inPage<A extends unknown[], R>(tabId: number, func: (...args: A) => R, args: A, world: "MAIN" | "ISOLATED" = "MAIN"): Promise<R> {
  const [result] = await chrome.scripting.executeScript({ target: { tabId }, world, func, args });
  return result?.result as R;
}

function waitForLoad(tabId: number, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      setTimeout(resolve, 400);
    };
    const listener = (id: number, info: { status?: string }) => id === tabId && info.status === "complete" && done();
    const timer = setTimeout(done, timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((t) => t.status === "complete" && done(), done);
  });
}

/** The "AI is controlling this tab" bar with a Stop button. Re-added after every navigation. */
function showBanner() {
  if (document.getElementById("__repro_banner")) return;
  const host = document.createElement("div");
  host.id = "__repro_banner";
  host.style.cssText = "position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483647";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `<div style="display:flex;align-items:center;gap:12px;background:#262626;color:#fff;font:14px/1.2 system-ui,sans-serif;padding:8px 8px 8px 16px;border-radius:999px;box-shadow:0 8px 16px rgba(0,0,0,.25)">
    <span style="width:8px;height:8px;border-radius:50%;background:#f5222d"></span><span>Repro's AI is reproducing a bug in this tab</span>
    <button style="all:unset;cursor:pointer;background:#fff;color:#262626;border-radius:999px;padding:6px 14px">Stop</button></div>`;
  root.querySelector("button")!.addEventListener("click", () => chrome.runtime.sendMessage({ type: "repro:agent-stop" }));
  document.documentElement.appendChild(host);
}

/** Shared with the background: the agent's tab (for console errors), a stop switch, and whether it finished. */
export type AgentRun = { stop: () => void; consoleErrors: string[]; tabId?: number; done: boolean };

/**
 * Opens the page in a new window, attaches the debugger and loops: observe → ask the app → act.
 * A "verify" run is the same loop after a fix: success means the bug no longer happens.
 * Resolves with the run id after the first step so the web app can open the live view.
 */
export function startReproduce(
  opts: { reportId: string; pageUrl: string; purpose: "reproduce" | "verify"; emulation?: Emulation },
  run: AgentRun,
): Promise<string> {
  const { reportId, pageUrl, purpose, emulation } = opts;
  return new Promise((resolveRunId, rejectRunId) => {
    let stopped = false;
    run.stop = () => (stopped = true);
    void (async () => {
      const win = await chrome.windows.create({ url: pageUrl, width: 1280, height: 860, focused: true });
      const tabId = win?.tabs?.[0]?.id;
      if (!tabId) {
        run.done = true;
        return rejectRunId(new Error("Couldn't open a window"));
      }
      run.tabId = tabId;
      const origin = new URL(pageUrl).origin;
      const target = { tabId };
      let runId: string | undefined;
      let lastResult: string | undefined;
      try {
        await waitForLoad(tabId);
        await chrome.debugger.attach(target, "1.3");
        if (emulation) await emulate(target, emulation);
        for (;;) {
          await inPage(tabId, showBanner, [], "ISOLATED").catch(() => {});
          const snap = await inPage(tabId, snapshotPage, []);
          const shot = await cdp<{ data: string }>(target, "Page.captureScreenshot", {
            format: "jpeg",
            quality: 70,
            clip: { x: 0, y: 0, width: snap.viewport.width, height: snap.viewport.height, scale: 1 / snap.viewport.pixelRatio },
          });
          const observation: AgentObservation = {
            url: snap.url,
            title: snap.title,
            elements: snap.elements,
            text: snap.text,
            screenshot: `data:image/jpeg;base64,${shot.data}`,
            consoleErrors: run.consoleErrors.splice(0).slice(-10),
            lastResult,
          };
          if (stopped) break;
          let step: AgentStepResponse;
          try {
            step = await api<AgentStepResponse>("/api/agent/step", { json: { runId, reportId: runId ? undefined : reportId, purpose: runId ? undefined : purpose, observation } });
          } catch (e) {
            if (e instanceof ApiError && e.status === 409) break; // stopped from the dashboard
            throw e;
          }
          if (!runId) {
            runId = step.runId;
            resolveRunId(runId);
          }
          if (step.action.type === "done" || step.action.type === "give_up") break;
          if (step.confirm && !(await inPage(tabId, (q: string) => window.confirm(`Repro: ${q}`), [step.confirm]))) {
            await api(`/api/agent/${runId}/stop`, { method: "POST" });
            break;
          }
          if (stopped) break;
          lastResult = await perform(target, step.action, origin, snap);
        }
        if (stopped && runId) await api(`/api/agent/${runId}/stop`, { method: "POST" }).catch(() => {});
      } catch (e) {
        if (!runId) rejectRunId(e);
        console.error("Reproduce run failed", e);
      } finally {
        await chrome.debugger.detach(target).catch(() => {});
        await inPage(tabId, () => document.getElementById("__repro_banner")?.remove(), [], "ISOLATED").catch(() => {});
        run.done = true;
      }
    })();
  });
}

async function perform(target: Target, action: AgentAction, origin: string, snap: PageSnapshot): Promise<string> {
  const { tabId } = target;
  try {
    switch (action.type) {
      case "click": {
        const p = await inPage(tabId, elementCenter, [action.id]);
        if (!p) return `error: element [${action.id}] isn't on the page any more; use the new element list`;
        const base = { x: p.x, y: p.y, button: "left", clickCount: 1 };
        await cdp(target, "Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
        await cdp(target, "Input.dispatchMouseEvent", { type: "mousePressed", ...base });
        await cdp(target, "Input.dispatchMouseEvent", { type: "mouseReleased", ...base });
        await settle(tabId);
        return "ok";
      }
      case "select": {
        const r = await inPage(tabId, selectOption, [action.id, action.option]);
        if (r.startsWith("ok:")) {
          await settle(tabId);
          return `ok, selected "${r.slice(3)}"`;
        }
        if (r.startsWith("reverted:")) return `the page didn't accept it: the dropdown changed straight back to "${r.slice(9)}" (if the report describes this, it's the bug)`;
        return r === "no-option" ? `error: [${action.id}] has no option "${action.option}"; see options=[…] in the element list` : `error: [${action.id}] isn't a dropdown on the page`;
      }
      case "click_at": {
        const base = { x: action.x, y: action.y, button: "left", clickCount: 1 };
        await cdp(target, "Input.dispatchMouseEvent", { type: "mouseMoved", x: action.x, y: action.y });
        await cdp(target, "Input.dispatchMouseEvent", { type: "mousePressed", ...base });
        await cdp(target, "Input.dispatchMouseEvent", { type: "mouseReleased", ...base });
        await settle(tabId);
        return "ok";
      }
      case "type": {
        const focused = await inPage(tabId, focusAndClear, [action.id]);
        if (focused === "password") return "error: blocked, the agent never types into password fields";
        if (focused !== "ok") return `error: element [${action.id}] isn't on the page any more`;
        await cdp(target, "Input.insertText", { text: action.text });
        if (action.submit) {
          await pressKey(target, "Enter");
          await settle(tabId);
        }
        return "ok";
      }
      case "press":
        if (await inPage(tabId, focusedIsPassword, [])) return "error: blocked, the agent never types into password fields";
        await pressKey(target, action.key);
        await settle(tabId);
        return "ok";
      case "scroll":
        await cdp(target, "Input.dispatchMouseEvent", {
          type: "mouseWheel",
          x: snap.viewport.width / 2,
          y: snap.viewport.height / 2,
          deltaX: 0,
          deltaY: (action.direction === "down" ? 1 : -1) * snap.viewport.height * 0.8,
        });
        await sleep(400);
        return "ok";
      case "navigate": {
        const url = new URL(action.url, snap.url);
        if (url.origin !== origin) return "error: blocked, the agent stays on this site";
        await chrome.tabs.update(tabId, { url: url.href });
        await waitForLoad(tabId);
        return "ok";
      }
      case "wait":
        await sleep(action.ms);
        return "ok";
      case "done":
      case "give_up":
        return "ok";
    }
  } catch (e) {
    return `error: ${String((e as Error).message).slice(0, 200)}`;
  }
}

async function pressKey(target: Target, key: string) {
  const k = KEYS[key] ?? { code: key, keyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0 };
  const text = key === "Enter" ? "\r" : key.length === 1 ? key : undefined;
  await cdp(target, "Input.dispatchKeyEvent", { type: "keyDown", key, code: k.code, windowsVirtualKeyCode: k.keyCode, text });
  await cdp(target, "Input.dispatchKeyEvent", { type: "keyUp", key, code: k.code, windowsVirtualKeyCode: k.keyCode });
}

/** Lets clicks finish: a navigation it started, or the page's own updates. */
async function settle(tabId: number) {
  await sleep(300);
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === "loading") await waitForLoad(tabId);
  else await sleep(300);
}
