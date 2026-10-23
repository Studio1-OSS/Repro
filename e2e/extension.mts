/// <reference types="chrome" />
// End to end with the real extension against a running app, on the bench fixture:
//   pair → screenshot (annotate, skip) → AI report → reproduce in the browser
//   → project → suggest a fix → check in sandbox → apply → verify in the browser
//   → instant replay → responsive scan
// The fixture is copied to a temp folder, so applying the fix never touches bench/app.
//
//   pnpm dev   (or APP_URL=http://localhost:3100)
//   pnpm ext:build && pnpm e2e
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { chromiumPath } from "../src/server/browser/driver.ts";

const APP = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
const EXTENSION = fileURLToPath(new URL("../extension/.output/chrome-mv3", import.meta.url));
const executablePath = chromiumPath();
if (!executablePath) {
  console.error("✗ Needs Playwright's Chromium (branded Chrome won't load unpacked extensions): npx playwright install chromium");
  process.exit(1);
}

// A private copy of the fixture: the fix gets applied to it, and its dev server picks the change up.
const appDir = mkdtempSync(join(tmpdir(), "repro-e2e-app-"));
cpSync(fileURLToPath(new URL("../bench/app/", import.meta.url)), appDir, { recursive: true });
const { LOGIN, startServer } = (await import(join(appDir, "server.mjs"))) as typeof import("../bench/app/server.mjs");
// Each request re-reads the static files, so applied fixes take effect without a restart. The server
// module itself is loaded once; restart it after server-side fixes.
let shopServer = await startServer(Number(process.env.SHOP_PORT || 4410));
const SHOP = shopServer.url;

const step = (msg: string) => console.log(`→ ${msg}`);
const expectText = async (page: Page, re: RegExp, timeout = 180_000) => page.getByText(re).first().waitFor({ timeout });

const context: BrowserContext = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "repro-e2e-")), {
  executablePath,
  headless: false,
  viewport: { width: 1440, height: 900 },
  args: ["--headless=new", `--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
});

/** A page that will open, without an unhandled rejection masking the real error if the test fails first. */
const nextPage = (predicate: (p: Page) => boolean, timeout = 60_000) => {
  const p = context.waitForEvent("page", { predicate, timeout });
  p.catch(() => {});
  return p;
};

async function popupFor(extId: string, tabUrl: string) {
  const popup = await context.newPage();
  // chrome.* only exists on extension pages: load one, find the tab, then open the popup for it.
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  const tabId = await popup.evaluate(async (url) => (await chrome.tabs.query({ url: `${url}/*` }))[0]?.id, tabUrl);
  await popup.goto(`chrome-extension://${extId}/popup.html?tab=${tabId}`);
  return popup;
}

try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const extId = new URL(worker.url()).host;
  step(`extension loaded (${extId})`);

  const app = context.pages()[0] ?? (await context.newPage());
  step("sign up and pair");
  await app.goto(`${APP}/sign-up`);
  await app.fill('input[name="name"]', "E2E Tester");
  await app.fill('input[name="email"]', `e2e-${Date.now()}@repro.test`);
  await app.fill('input[name="password"]', "repro-e2e-pass");
  await app.click('button[type="submit"]');
  await app.waitForURL(`${APP}/dashboard`);
  await app.goto(`${APP}/connect`);
  await app.getByText("Repro extension found in this browser").waitFor();
  await app.getByRole("button", { name: "Connect this browser" }).click();
  await app.getByText("Connected", { exact: true }).waitFor();

  step("hit the coupon bug");
  const shop = await context.newPage();
  await shop.goto(`${SHOP}/login?next=/checkout`);
  await shop.fill("#p", LOGIN.password);
  await Promise.all([shop.waitForURL(`${SHOP}/checkout`), shop.click("button")]);
  await shop.fill("#coupon", "SAVE10");
  await shop.click("#apply");
  await shop.waitForTimeout(800);
  await shop.bringToFront();

  step("screenshot → annotate → report");
  const popup = await popupFor(extId, SHOP);
  await popup.locator("#note").fill("Total shows $NaN after applying a coupon");
  const annotateOpened = nextPage((p) => p.url().includes("annotate.html"), 60_000);
  await popup.getByRole("button", { name: /Screenshot with the last 30 s/ }).click();
  const annotate = await annotateOpened;
  await annotate.locator("canvas").waitFor();
  const box = (await annotate.locator("canvas").boundingBox())!;
  await annotate.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.55);
  await annotate.mouse.down();
  await annotate.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.65);
  await annotate.mouse.up();
  const reportOpened = nextPage((p) => p.url().includes("/r/"), 60_000);
  await annotate.getByRole("button", { name: "Create report" }).click();
  const report = await reportOpened;
  await report.bringToFront();
  await report.getByText("Likely cause").waitFor({ timeout: 180_000 });
  step(`report: "${await report.locator("h1").innerText()}"`);
  await report.getByRole("tab", { name: "Performance" }).click();
  await report.getByText("Long tasks").waitFor();
  await report.getByRole("tab", { name: "Elements" }).click();
  await report.locator('iframe[title="DOM snapshot"]').waitFor();

  step("reproduce in the browser");
  await report.getByRole("button", { name: "Reproduce in my browser" }).click();
  await report.waitForURL(/\/runs\//, { timeout: 120_000 });
  await report.locator("h1", { hasText: /^(Reproduced|Not reproduced|Stopped|Run failed)$/ }).waitFor({ timeout: 300_000 });
  const verdict = await report.locator("h1").innerText();
  step(`agent: ${verdict}`);
  if (verdict !== "Reproduced") throw new Error(`Expected "Reproduced", got "${verdict}"`);
  const reportUrl = report.url().replace(/\/runs\/.*$/, "");

  step("project → fix → sandbox → apply → verify");
  await app.bringToFront();
  await app.goto(`${APP}/projects?origin=${encodeURIComponent(SHOP)}`);
  await app.locator('input[name="name"]').fill("Bench fixture (e2e copy)");
  await app.locator('input[name="localPath"]').fill(appDir);
  await app.locator('input[name="checkCommand"]').fill('node --test --test-name-pattern="10% coupon"');
  await app.locator('input[name="startCommand"]').fill("node server.mjs");
  await app.locator('input[name="appPort"]').fill("4400");
  await app.locator('input[name="signInPath"]').fill("/login");
  await app.locator('input[name="signInEmail"]').fill(LOGIN.email);
  await app.locator('input[name="signInPassword"]').fill(LOGIN.password);
  await app.getByRole("button", { name: "Save project" }).click();
  await app.getByText("Project saved").waitFor();

  await report.goto(reportUrl);
  await report.getByRole("button", { name: "Suggest a fix" }).click();
  await report.getByRole("button", { name: "Check in sandbox" }).waitFor({ timeout: 300_000 });
  step("fix proposed; checking in the sandbox");
  await report.getByRole("button", { name: "Check in sandbox" }).click();
  await expectText(report, /Fix verified in the sandbox|Not verified/, 600_000);
  const sandboxOk = await report.getByText("Fix verified in the sandbox").isVisible();
  step(`sandbox: ${sandboxOk ? "verified" : "not verified"}`);
  await report.getByRole("button", { name: /Apply to my folder/ }).click();
  await expectText(report, /Written to/, 30_000);
  // Server-side edits need a restart of the copy's server; client-side ones are picked up on reload.
  shopServer.close();
  shopServer = await (await import(`${join(appDir, "server.mjs")}?v=${Date.now()}`)).startServer(Number(new URL(SHOP).port));
  await report.getByRole("button", { name: "Verify in my browser" }).click();
  await report.waitForURL(/\/runs\//, { timeout: 120_000 });
  await report.locator("h1", { hasText: /^(Fix verified|Still happens|Stopped|Run failed)$/ }).waitFor({ timeout: 300_000 });
  const verified = await report.locator("h1").innerText();
  step(`verify run: ${verified}`);

  step("instant replay");
  await shop.bringToFront();
  await shop.goto(`${SHOP}/cart`);
  const popup2 = await popupFor(extId, SHOP);
  await popup2.getByText("Instant replay on this tab").click();
  await popup2.getByRole("button", { name: "Save last 60 s" }).waitFor();
  await popup2.close();
  await shop.reload();
  await shop.click("#plus");
  await shop.waitForTimeout(1200);
  const popup3 = await popupFor(extId, SHOP);
  await popup3.locator("#note").fill("Quantity jumps by two");
  const replayOpened = nextPage((p) => p.url().includes("/r/"), 60_000);
  await popup3.getByRole("button", { name: "Save last 60 s" }).click();
  const replay = await replayOpened;
  await replay.locator(".repro-replay iframe").first().waitFor({ timeout: 60_000 });
  step("replay report plays the DOM");

  step("responsive scan");
  await shop.goto(`${SHOP}/checkout`);
  const popup4 = await popupFor(extId, SHOP);
  const scanOpened = nextPage((p) => p.url().includes("/r/"), 120_000);
  await popup4.getByRole("button", { name: "Check the layout at 5 screen sizes" }).click();
  const watcher = await context.newPage();
  await watcher.goto(`chrome-extension://${extId}/popup.html`);
  const scan = await Promise.race([
    scanOpened,
    (async () => {
      // Surface the extension's own error instead of a bare timeout.
      for (;;) {
        await watcher.waitForTimeout(1500);
        const s = await watcher.evaluate(() => chrome.runtime.sendMessage({ type: "repro:status" }));
        if (!s.busy && s.lastError) throw new Error(`responsive scan: ${s.lastError}`);
      }
    })(),
  ]);
  await expectText(scan, /Layout problems/, 180_000);
  step("layout findings shown");

  if (!sandboxOk || verified !== "Fix verified") throw new Error(`Fix loop: sandbox ${sandboxOk}, verify "${verified}"`);
  console.log("\n✓ e2e passed: pair → screenshot → report → reproduce → fix → sandbox → apply → verify → replay → responsive");
} finally {
  await context.close();
  shopServer.close();
}
