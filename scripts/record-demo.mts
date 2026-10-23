// Records a real session of Repro as one screen recording: the extension, the app and the AI working on a
// real open-source web app (saucelabs/sample-app-web, the code behind saucedemo.com), run locally.
//
// The tab on screen is captured with Chrome's own screencast at native size, the pointer is drawn so you can see
// clicks, and each piece is placed in a browser window (the popup over the page it belongs to). Waiting
// is sped up; nothing else is edited. Writes public/demo/repro-demo.mp4, a poster and docs/demo.gif.
//
//   APP_URL=http://localhost:3100 SHOP_URL=http://localhost:4500 SHOP_DIR=/path/to/sample-app-web pnpm tsx scripts/record-demo.mts
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext, type CDPSession, type Page } from "playwright-core";
import { chromiumPath } from "../src/server/browser/driver.ts";

const APP = process.env.APP_URL || "http://localhost:3100";
const SHOP = process.env.SHOP_URL || "http://localhost:4500";
const SHOP_DIR = process.env.SHOP_DIR!;
if (!SHOP_DIR) throw new Error("Set SHOP_DIR to the sample-app-web checkout");
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const EXTENSION = join(ROOT, "extension/.output/chrome-mv3");
// Thousands of frames: put them somewhere roomy (DEMO_WORK_DIR) and delete them at the end.
const WORK = mkdtempSync(join(process.env.DEMO_WORK_DIR || tmpdir(), "repro-demo-"));
const OUT = join(ROOT, "public/demo");
const SHOTS = join(ROOT, "docs/screenshots");
// Captured at native size: headless Chrome's screen is 1080px tall, which leaves 907px for the page, and
// its screencast ignores device-scale emulation, so pages are laid out at exactly the captured size.
const VIEW = { width: 1680, height: 907 };

// Output canvas: a browser window centred on a soft background.
const CANVAS = { w: 1920, h: 1080 };
const WIN = { x: 120, y: 46, w: 1680, bar: 76 };
const CONTENT = { x: WIN.x, y: WIN.y + WIN.bar, w: VIEW.width, h: VIEW.height };

// ── Capture: one segment per stretch of time a tab (at one URL) is on screen ──
type Frame = { ts: number; file: string };
type Segment = { page: Page; start: number; end: number; speed: number; maxSeconds?: number; frames: Frame[]; under?: Segment; url: string; title: string; popupHeight?: number };
const segments: Segment[] = [];
let current: Segment | null = null;
let cdp: CDPSession | null = null;
let ctx: BrowserContext;
let frameNo = 0;
const isPopup = (p: Page) => p.url().includes("/popup.html");

async function stopCapture() {
  if (!current) return;
  current.end = Date.now();
  current.title ||= await current.page.title().catch(() => "");
  if (cdp) {
    await cdp.send("Page.stopScreencast").catch(() => {});
    await cdp.detach().catch(() => {});
    cdp = null;
  }
}

function newSegment(page: Page, opts: { speed?: number; maxSeconds?: number }, previous: Segment | null) {
  const under = isPopup(page) ? [...segments].reverse().find((s) => !isPopup(s.page)) : undefined;
  const seg: Segment = { page, start: Date.now(), end: 0, speed: opts.speed ?? 1, maxSeconds: opts.maxSeconds, frames: [], under, url: page.url(), title: "" };
  // Carry the last frame over so the new stretch starts with what was on screen.
  if (previous && previous.page === page && previous.frames.length) seg.frames.push({ ...previous.frames.at(-1)!, ts: seg.start });
  segments.push(seg);
  current = seg;
  return seg;
}

/** Puts `page` on screen. `speed` speeds up the stretch; `maxSeconds` caps how long it lasts in the cut. */
async function show(page: Page, opts: { speed?: number; maxSeconds?: number } = {}) {
  const previous = current;
  await stopCapture();
  const seg = newSegment(page, opts, previous);
  if (isPopup(page)) seg.popupHeight = Math.min(VIEW.height, Math.max(420, (await page.evaluate(() => document.body.scrollHeight + 40))));
  const session = await ctx.newCDPSession(page);
  cdp = session;
  session.on("Page.screencastFrame", (f: { data: string; metadata: { timestamp?: number }; sessionId: number }) => {
    const file = join(WORK, `f${String(frameNo++).padStart(6, "0")}.jpg`);
    writeFileSync(file, Buffer.from(f.data, "base64"));
    if (current?.page === page) current.frames.push({ ts: f.metadata.timestamp ? f.metadata.timestamp * 1000 : Date.now(), file });
    void session.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await session.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: VIEW.width, maxHeight: VIEW.height, everyNthFrame: 1 });
}

/** A navigation on the tab on screen starts a new stretch, so the window shows the right URL. */
function followNavigations(page: Page) {
  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame() || current?.page !== page || Date.now() - current.start < 150) return;
    const prev = current;
    prev.end = Date.now();
    prev.url = prev.url || page.url();
    prev.title = "";
    void page.title().then((t) => (prev.title = t), () => {});
    newSegment(page, { speed: prev.speed, maxSeconds: prev.maxSeconds }, prev);
  });
}

/** Waits for something slow, shown at `maxSeconds` at most, then back to normal speed. */
async function waitShown<T>(page: Page, maxSeconds: number, fn: () => Promise<T>): Promise<T> {
  await show(page, { maxSeconds });
  const out = await fn();
  await show(page);
  return out;
}

const pause = (page: Page, ms: number) => page.waitForTimeout(ms);
const snap = (page: Page, name: string) => page.screenshot({ path: join(SHOTS, `${name}.png`) }).catch(() => {});

/** A visible pointer and click ripple (headless Chrome draws none). Ignored by Repro's own capture. */
const CURSOR = `(() => {
  if (window.__demoCursor) return; window.__demoCursor = 1;
  const add = () => {
    const c = document.createElement('div');
    c.setAttribute('data-repro-ignore', '');
    c.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);transition:transform .12s ease-out';
    c.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 2l15 9-6.5 1.6L9.7 19z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(c);
    addEventListener('mousemove', (e) => { c.style.transform = 'translate(' + (e.clientX - 3) + 'px,' + (e.clientY - 2) + 'px)'; }, true);
    addEventListener('mousedown', (e) => {
      const r = document.createElement('div');
      r.setAttribute('data-repro-ignore', '');
      r.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;border-radius:50%;background:rgba(0,112,213,.28);border:2px solid rgba(0,112,213,.7);width:10px;height:10px;left:' + (e.clientX - 5) + 'px;top:' + (e.clientY - 5) + 'px;transition:all .45s ease-out;opacity:1';
      document.documentElement.appendChild(r);
      requestAnimationFrame(() => { r.style.width = r.style.height = '46px'; r.style.left = (e.clientX - 23) + 'px'; r.style.top = (e.clientY - 23) + 'px'; r.style.opacity = '0'; });
      setTimeout(() => r.remove(), 600);
    }, true);
  };
  if (document.documentElement) add(); else addEventListener('DOMContentLoaded', add);
})();`;

/** Moves the pointer onto an element before acting on it, so the viewer can follow. */
async function point(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
}

async function main() {
  const worker = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
  const extId = new URL(worker.url()).host;
  // The popup page renders at full size; its 340px-wide UI is cropped out of the frames.
  const popupFor = async (tabUrl: string) => {
    const p = await ctx.newPage();
    await p.goto(`chrome-extension://${extId}/popup.html`);
    const tabId = await p.evaluate(async (url) => (await chrome.tabs.query({ url: `${url}/*` }))[0]?.id, tabUrl);
    await p.goto(`chrome-extension://${extId}/popup.html?tab=${tabId}`);
    await p.waitForTimeout(300);
    return p;
  };

  // 1. Repro: sign up and connect the extension.
  const app = ctx.pages()[0] ?? (await ctx.newPage());
  await app.goto(`${APP}/`);
  await show(app);
  await pause(app, 2500);
  await app.mouse.wheel(0, 700);
  await pause(app, 1800);
  await app.goto(`${APP}/sign-up`);
  await point(app, 'input[name="name"]');
  await app.locator('input[name="name"]').click();
  await app.keyboard.type("Amit", { delay: 50 });
  await app.locator('input[name="email"]').click();
  await app.keyboard.type(`amit+${Date.now() % 100000}@studio1.dev`, { delay: 18 });
  await app.locator('input[name="password"]').click();
  await app.keyboard.type("correct-horse-42", { delay: 18 });
  await point(app, 'button[type="submit"]');
  await app.click('button[type="submit"]');
  await app.waitForURL(`${APP}/dashboard`);
  await pause(app, 1000);
  await app.goto(`${APP}/connect`);
  await app.getByText("Repro extension found in this browser").waitFor();
  await point(app, "text=Connect this browser >> nth=1");
  await app.getByRole("button", { name: "Connect this browser" }).click();
  await app.getByText("Connected", { exact: true }).waitFor();
  await pause(app, 1400);

  // 2. The shop: sign in as the account that reported the bug.
  const shop = await ctx.newPage();
  await shop.goto(SHOP);
  await show(shop);
  await shop.locator("#user-name").click();
  await shop.keyboard.type("problem_user", { delay: 45 });
  await shop.locator("#password").click();
  await shop.keyboard.type("secret_sauce", { delay: 45 });
  await point(shop, "#login-button");
  await shop.click("#login-button");
  await shop.waitForURL(/inventory/, { waitUntil: "commit" });
  await pause(shop, 1200);
  await snap(shop, "app-under-test");

  // 3. Turn on instant replay for this tab, from the popup.
  const popup = await popupFor(SHOP);
  await show(popup);
  await pause(popup, 900);
  await point(popup, "text=Instant replay on this tab");
  await popup.getByText("Instant replay on this tab").click();
  await pause(popup, 1300);
  await popup.close();

  // 4. Hit the bug: sorting by price does nothing.
  await shop.reload();
  await show(shop);
  await pause(shop, 900);
  await point(shop, ".product_sort_container");
  await shop.selectOption(".product_sort_container", "lohi");
  await pause(shop, 1600);
  await shop.selectOption(".product_sort_container", "hilo");
  await pause(shop, 1800);

  // 5. Save the last 60 seconds as a report.
  const popup2 = await popupFor(SHOP);
  await show(popup2);
  await popup2.locator("#note").click();
  await popup2.keyboard.type("Sorting by price does nothing (signed in as problem_user)", { delay: 22 });
  await snap(popup2, "popup");
  await pause(popup2, 500);
  const reportOpened = ctx.waitForEvent("page", { predicate: (p) => p.url().includes("/r/"), timeout: 120_000 });
  await point(popup2, "text=Save last 60 s");
  await popup2.getByRole("button", { name: "Save last 60 s" }).click();
  const report = await reportOpened;
  await report.waitForLoadState("domcontentloaded");

  // 6. The AI report streams in.
  await waitShown(report, 6, () => report.getByText("Likely cause").waitFor({ timeout: 180_000 }));
  await pause(report, 2600);
  await snap(report, "report");
  await report.mouse.move(700, 600, { steps: 10 });
  await report.mouse.wheel(0, 620);
  await pause(report, 1800);
  await report.getByRole("tab", { name: /Replay|Elements/ }).click().catch(() => {});
  await pause(report, 2600);
  await report.getByRole("tab", { name: "Network" }).click().catch(() => {});
  await pause(report, 1500);
  await snap(report, "devtools");
  await report.mouse.wheel(0, -1400);
  await pause(report, 700);

  // 7. Reproduce it in the browser.
  const agentWindow = ctx.waitForEvent("page", { predicate: (p) => p.url().startsWith(SHOP), timeout: 60_000 });
  await point(report, "text=Reproduce in my browser");
  await report.getByRole("button", { name: "Reproduce in my browser" }).click();
  const agent = await agentWindow;
  await agent.waitForLoadState("domcontentloaded").catch(() => {});
  await show(agent, { maxSeconds: 9 });
  await report.waitForURL(/\/runs\//, { timeout: 120_000 });
  await agent.waitForTimeout(9000);
  await waitShown(report, 6, () => report.locator("h1", { hasText: /^(Reproduced|Not reproduced|Stopped|Run failed)$/ }).waitFor({ timeout: 300_000 }));
  await pause(report, 2800);
  await snap(report, "reproduce");

  // 8. Connect the project's source.
  await app.goto(`${APP}/projects?origin=${encodeURIComponent(SHOP)}`);
  await show(app);
  await pause(app, 800);
  await app.locator('input[name="name"]').click();
  await app.keyboard.type("Swag Labs (sample-app-web)", { delay: 18 });
  await app.locator('input[name="localPath"]').fill(SHOP_DIR);
  await app.locator('input[name="checkCommand"]').fill("npm ci --no-audit --no-fund --ignore-scripts && npx jest src/pages --watchAll=false");
  await pause(app, 700);
  await point(app, "text=Save project");
  await app.getByRole("button", { name: "Save project" }).click();
  await app.getByText("Project saved").waitFor();
  await pause(app, 1200);

  // 9. Ask for a fix, check it in the sandbox, apply it.
  const reportUrl = report.url().replace(/\/runs\/.*$/, "");
  await report.goto(reportUrl);
  await show(report);
  await report.getByRole("button", { name: "Suggest a fix" }).scrollIntoViewIfNeeded();
  await pause(report, 600);
  await point(report, "text=Suggest a fix");
  await report.getByRole("button", { name: "Suggest a fix" }).click();
  await waitShown(report, 6, () => report.getByRole("button", { name: "Check in sandbox" }).waitFor({ timeout: 600_000 }));
  await pause(report, 3800);
  await point(report, "text=Check in sandbox");
  await report.getByRole("button", { name: "Check in sandbox" }).click();
  await waitShown(report, 7, () => report.getByText(/Fix verified in the sandbox|Not verified/).waitFor({ timeout: 900_000 }));
  await report.getByText(/Fix verified in the sandbox|Not verified/).scrollIntoViewIfNeeded();
  await pause(report, 3000);
  await snap(report, "fix");
  await point(report, "text=Apply to my folder");
  await report.getByRole("button", { name: /Apply to my folder/ }).click();
  await report.getByText(/Written to/).waitFor();
  await pause(report, 2200);

  // 10. Verify the fix in the browser (the dev server has hot-reloaded the change). The store's own session
  // lasts 10 minutes, so sign in again first, the way the person would.
  // Only shown if the session has expired.
  await shop.goto(`${SHOP}/inventory.html`);
  if (await shop.locator("#user-name").isVisible().catch(() => false)) {
    await show(shop);
    await shop.locator("#user-name").click();
    await shop.keyboard.type("problem_user", { delay: 30 });
    await shop.locator("#password").click();
    await shop.keyboard.type("secret_sauce", { delay: 30 });
    await point(shop, "#login-button");
    await shop.click("#login-button");
    await shop.waitForURL(/inventory/, { waitUntil: "commit", timeout: 15_000 });
  }
  await pause(shop, 900);
  await show(report);
  const verifyWindow = ctx.waitForEvent("page", { predicate: (p) => p.url().startsWith(SHOP), timeout: 60_000 });
  await point(report, "text=Verify in my browser");
  await report.getByRole("button", { name: "Verify in my browser" }).click();
  const verifier = await verifyWindow;
  await verifier.waitForLoadState("domcontentloaded").catch(() => {});
  await show(verifier, { maxSeconds: 8 });
  await report.waitForURL(/\/runs\//, { timeout: 120_000 });
  await verifier.waitForTimeout(7000);
  await waitShown(report, 5, () => report.locator("h1", { hasText: /^(Fix verified|Still happens|Stopped|Run failed)$/ }).waitFor({ timeout: 300_000 }));
  await pause(report, 3000);
  await snap(report, "verify");

  // 11. A responsive check of the shop.
  await show(shop);
  await shop.reload();
  await pause(shop, 800);
  const popup3 = await popupFor(SHOP);
  await show(popup3);
  await pause(popup3, 700);
  const scanOpened = ctx.waitForEvent("page", { predicate: (p) => p.url().includes("/r/"), timeout: 120_000 });
  await point(popup3, "text=Check the layout at 5 screen sizes");
  await popup3.getByRole("button", { name: "Check the layout at 5 screen sizes" }).click();
  const scan = await scanOpened;
  await scan.waitForLoadState("domcontentloaded");
  await waitShown(scan, 5, () => scan.getByText(/Layout problems|Likely cause/).first().waitFor({ timeout: 180_000 }));
  for (const w of ["360px", "768px", "1440px"]) {
    await point(scan, `button:has-text("${w}")`);
    await scan.getByRole("button", { name: new RegExp(`^${w}`) }).click().catch(() => {});
    await pause(scan, 1500);
    if (w === "360px") await snap(scan, "responsive");
  }

  // 12. Back to the list.
  await app.goto(`${APP}/dashboard`);
  await show(app);
  await pause(app, 2600);
  await snap(app, "dashboard");
  await stopCapture();
}

// ── The window around each piece (rendered once per URL with the same browser) ──
async function renderChrome(seg: Segment, file: string) {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: CANVAS.w, height: CANVAS.h });
  const url = (seg.under ?? seg).url.replace(/^https?:\/\//, "");
  const target = (seg.under ?? seg).url;
  const title = (target.startsWith(SHOP) ? "Swag Labs" : target.startsWith(APP) ? "Repro" : (seg.under ?? seg).title || url).replace(/[<>&]/g, "");
  const popupOn = Boolean(seg.under);
  await page.setContent(`<!doctype html><html><body style="margin:0;width:${CANVAS.w}px;height:${CANVAS.h}px;background:linear-gradient(160deg,#eef3f8,#f7f9fa 55%,#e9eff5);font:15px -apple-system,system-ui,sans-serif">
  <div style="position:absolute;left:${WIN.x}px;top:${WIN.y}px;width:${WIN.w}px;height:${WIN.bar + CONTENT.h}px;border-radius:14px;background:#fff;box-shadow:0 30px 80px rgba(16,24,40,.18),0 0 0 1px rgba(16,24,40,.08);overflow:hidden">
    <div style="height:${WIN.bar}px;background:#f1f3f5;border-bottom:1px solid #e2e5e9;display:flex;flex-direction:column;justify-content:flex-end">
      <div style="display:flex;align-items:center;height:36px;padding:0 14px;gap:8px">
        <span style="width:12px;height:12px;border-radius:50%;background:#ff5f57"></span><span style="width:12px;height:12px;border-radius:50%;background:#febc2e"></span><span style="width:12px;height:12px;border-radius:50%;background:#28c840"></span>
        <div style="margin-left:18px;height:30px;align-self:flex-end;background:#fff;border-radius:9px 9px 0 0;padding:0 16px;display:flex;align-items:center;max-width:300px;color:#262626;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${title}</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;height:40px;padding:0 14px;background:#fff">
        <div style="flex:1;height:28px;border-radius:14px;background:#f1f3f5;display:flex;align-items:center;padding:0 14px;color:#4b5563;font-size:13px">${url}</div>
        <div style="width:30px;height:30px;border-radius:8px;display:flex;align-items:center;justify-content:center;${popupOn ? "background:#deeafd" : ""}">
          <svg viewBox="0 0 32 32" width="20" height="20"><rect x="1" y="1" width="30" height="30" rx="8" fill="#0070d5"/><path d="M23.9 10.6A9.2 9.2 0 1 0 25.2 16" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round"/><path d="M25.3 6.4v4.9h-4.9" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M13.2 10.4v10.8l2.7-2.5 1.9 4 1.9-.9-1.9-3.9h3.7z" fill="#fff"/></svg>
        </div>
      </div>
    </div>
  </div></body></html>`);
  await page.screenshot({ path: file });
  await page.close();
}

/** One clip: the frames of a segment with their real timing (sped up as asked), inside the window. */
function renderSegment(seg: Segment, i: number, chrome: string): string | null {
  const raw = (seg.end - seg.start) / 1000;
  if (raw < 0.25 || !seg.frames.length) return null;
  const speed = Math.max(seg.speed, seg.maxSeconds ? raw / seg.maxSeconds : 1);
  const frames = seg.frames.filter((f) => f.ts <= seg.end).sort((a, b) => a.ts - b.ts);
  const lines: string[] = [];
  frames.forEach((f, k) => {
    const from = k === 0 ? seg.start : f.ts;
    const to = k + 1 < frames.length ? frames[k + 1].ts : seg.end;
    lines.push(`file '${f.file}'`, `duration ${Math.max(0.001, (to - from) / 1000 / speed).toFixed(3)}`);
  });
  lines.push(`file '${frames.at(-1)!.file}'`);
  const list = join(WORK, `seg-${i}.txt`);
  writeFileSync(list, lines.join("\n"));
  const out = join(WORK, `seg-${String(i).padStart(3, "0")}.mp4`);
  // Frame sizes change mid-stretch (Chrome's debugging infobar takes page height while the agent works), so
  // each frame is scaled per frame and laid onto a fixed white page instead of padded.
  const fitTo = (input: string, label: string) =>
    `color=c=white:s=${CONTENT.w}x${CONTENT.h}:r=30[${label}base];${input}scale=w=${CONTENT.w}:h=${CONTENT.h}:force_original_aspect_ratio=decrease:eval=frame:flags=lanczos[${label}fit];[${label}base][${label}fit]overlay=0:0:shortest=1:eval=frame[${label}]`;
  if (seg.under) {
    // The popup over a still of the page underneath, below the toolbar icon, like Chrome draws it.
    const under = seg.under.frames.at(-1)!.file;
    const pw = 340;
    const ph = Math.round((seg.popupHeight ?? 600) / 2) * 2;
    execFileSync("ffmpeg", [
      "-y", "-loglevel", "error",
      "-loop", "1", "-i", chrome,
      "-loop", "1", "-i", under,
      "-f", "concat", "-safe", "0", "-i", list,
      "-filter_complex",
      `${fitTo("[1:v]", "bg")};[2:v]crop=${pw}:${ph}:0:0,pad=${pw + 2}:${ph + 2}:1:1:color=0xd9d9d9[pop];[bg][pop]overlay=${CONTENT.w - pw - 26}:6:shortest=1:eval=frame[win];[0:v][win]overlay=${CONTENT.x}:${CONTENT.y}:shortest=1,fps=30,format=yuv420p`,
      "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", out,
    ]);
  } else {
    execFileSync("ffmpeg", [
      "-y", "-loglevel", "error",
      "-loop", "1", "-i", chrome,
      "-f", "concat", "-safe", "0", "-i", list,
      "-filter_complex", `${fitTo("[1:v]", "c")};[0:v][c]overlay=${CONTENT.x}:${CONTENT.y}:shortest=1,fps=30,format=yuv420p`,
      "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", out,
    ]);
  }
  return out;
}

ctx = await chromium.launchPersistentContext(join(WORK, "profile"), {
  executablePath: chromiumPath(),
  headless: false,
  viewport: VIEW,
  deviceScaleFactor: 1,
  args: ["--headless=new", `--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
});
await ctx.addInitScript({ content: CURSOR });
ctx.on("page", followNavigations);
ctx.pages().forEach(followNavigations);
try {
  await main();
} finally {
  await stopCapture();
  mkdirSync(OUT, { recursive: true });
  const parts: string[] = [];
  const timeline: { start: number; end: number; label: string }[] = [];
  let t = 0;
  for (const [i, seg] of segments.entries()) {
    const chrome = join(WORK, `chrome-${i}.png`);
    await renderChrome(seg, chrome);
    const clip = renderSegment(seg, i, chrome);
    if (!clip) continue;
    const dur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", clip]).toString());
    timeline.push({ start: t, end: t + dur, label: seg.url });
    t += dur;
    parts.push(clip);
  }
  await ctx.close();
  const list = join(WORK, "list.txt");
  writeFileSync(list, parts.map((p) => `file '${p}'`).join("\n"));
  const final = join(OUT, "repro-demo.mp4");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c:v", "libx264", "-preset", "slow", "-crf", "22", "-pix_fmt", "yuv420p", "-movflags", "+faststart", final]);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", "3", "-i", final, "-frames:v", "1", "-q:v", "3", join(OUT, "repro-demo-poster.jpg")]);
  // The README preview: the whole session at 4x, small enough for GitHub.
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error", "-i", final,
    "-vf", "setpts=PTS/4,fps=8,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
    join(ROOT, "docs/demo.gif"),
  ]);
  writeFileSync(join(OUT, "..", "..", "docs", "demo-timeline.json"), JSON.stringify(timeline, null, 1));
  rmSync(WORK, { recursive: true, force: true });
  console.log(`✓ ${final} (${t.toFixed(1)}s)`);
}
