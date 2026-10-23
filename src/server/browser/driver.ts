// Playwright driver: records like the extension (same page runtime) and runs agent actions in a page.
// Used by the bench, the e2e test and the sandbox (verifying a fix server-side).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import type { CapturedEvent, PageSnapshot } from "@/shared/page-runtime";
import type { AgentAction, AgentObservation } from "@/shared/schemas";

/** The page runtime as injectable source (its functions are self-contained by design). */
// Read from the project root, which works for tsx scripts and the Next.js server alike.
export const RUNTIME_SOURCE = readFileSync(join(process.cwd(), "src/shared/page-runtime.js"), "utf8").replace(/^export /gm, "");
const call = (fn: string, ...args: unknown[]) => `(function(){${RUNTIME_SOURCE};return ${fn}(${args.map((a) => JSON.stringify(a)).join(",")});})()`;

export const VIEWPORT = { width: 1280, height: 800 };

/** Playwright's own Chromium if installed (it can load extensions), else the installed Chrome. */
export function chromiumPath(): string | undefined {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const cache = join(homedir(), process.platform === "darwin" ? "Library/Caches/ms-playwright" : ".cache/ms-playwright");
  if (!existsSync(cache)) return undefined;
  const dir = readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().at(-1);
  if (!dir) return undefined;
  const candidates = [
    "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
    "chrome-linux/chrome",
    "chrome-linux64/chrome",
  ].map((p) => join(cache, dir, p));
  return candidates.find((p) => existsSync(p));
}

export async function launchBrowser(): Promise<Browser> {
  const executablePath = chromiumPath();
  return executablePath ? chromium.launch({ executablePath, headless: true }) : chromium.launch({ channel: "chrome", headless: true });
}

/** A context whose pages run the capture runtime and hand every event to `events`. */
export async function recordingContext(browser: Browser) {
  const context = await browser.newContext({ viewport: VIEWPORT, locale: "en-US", timezoneId: "UTC" });
  const events: CapturedEvent[] = [];
  await context.exposeBinding("__reproSink", (_source, event: CapturedEvent) => void events.push(event));
  await context.addInitScript({ content: call("installCapture") });
  return { context, events };
}

export async function shot(page: Page): Promise<string> {
  return `data:image/jpeg;base64,${(await page.screenshot({ type: "jpeg", quality: 70 })).toString("base64")}`;
}

async function settle(page: Page) {
  await page.waitForLoadState("load", { timeout: 4_000 }).catch(() => {});
  await page.waitForTimeout(500);
}

export async function observe(page: Page, events: CapturedEvent[], sinceTs: number, lastResult?: string): Promise<AgentObservation> {
  const snap = (await page.evaluate(call("snapshotPage"))) as PageSnapshot;
  const consoleErrors = events
    .filter((e) => e.ts >= sinceTs && e.kind === "console" && (e.data.level === "error" || e.data.level === "warn"))
    .map((e) => (e.kind === "console" ? e.data.text.slice(0, 300) : ""))
    .slice(-10);
  return { url: snap.url, title: snap.title, elements: snap.elements, text: snap.text, screenshot: await shot(page), consoleErrors, lastResult };
}

/** Runs one agent action. Returns the result line the model sees next turn. */
export async function perform(page: Page, action: AgentAction): Promise<string> {
  try {
    switch (action.type) {
      case "click": {
        const p = (await page.evaluate(call("elementCenter", action.id))) as { x: number; y: number } | null;
        if (!p) return `error: element [${action.id}] isn't on the page any more; use the new element list`;
        await page.mouse.click(p.x, p.y);
        await settle(page);
        return "ok";
      }
      case "select": {
        const r = (await page.evaluate(call("selectOption", action.id, action.option))) as string;
        if (r.startsWith("ok:")) {
          await settle(page);
          return `ok, selected "${r.slice(3)}"`;
        }
        if (r.startsWith("reverted:")) return `the page didn't accept it: the dropdown changed straight back to "${r.slice(9)}" (if the report describes this, it's the bug)`;
        return r === "no-option" ? `error: [${action.id}] has no option "${action.option}"; see options=[…] in the element list` : `error: [${action.id}] isn't a dropdown on the page`;
      }
      case "click_at":
        await page.mouse.click(action.x, action.y);
        await settle(page);
        return "ok";
      case "type": {
        const focused = await page.evaluate(call("focusAndClear", action.id));
        if (focused === "password") return "error: blocked, the agent never types into password fields";
        if (focused !== "ok") return `error: element [${action.id}] isn't on the page any more`;
        await page.keyboard.insertText(action.text);
        if (action.submit) {
          await page.keyboard.press("Enter");
          await settle(page);
        }
        return "ok";
      }
      case "press":
        if (await page.evaluate(call("focusedIsPassword"))) return "error: blocked, the agent never types into password fields";
        await page.keyboard.press(action.key);
        await settle(page);
        return "ok";
      case "scroll":
        await page.mouse.wheel(0, (action.direction === "down" ? 1 : -1) * VIEWPORT.height * 0.8);
        await page.waitForTimeout(300);
        return "ok";
      case "navigate": {
        const target = new URL(action.url, page.url());
        if (target.origin !== new URL(page.url()).origin) return "error: blocked, the agent stays on this site";
        await page.goto(target.href, { timeout: 10_000 });
        await settle(page);
        return "ok";
      }
      case "wait":
        await page.waitForTimeout(action.ms);
        return "ok";
      case "done":
      case "give_up":
        return "ok";
    }
  } catch (e) {
    return `error: ${String((e as Error).message).split("\n")[0].slice(0, 200)}`;
  }
}

export type { Browser, BrowserContext, Page };
