// Repro on real sites: public apps built for test-automation practice, with bugs that are really in their
// code (not ours). Same capture, report and agent code as the app. Results: bench/real-results.{json,md}.
//
//   pnpm bench:real
//   pnpm bench:real --only saucedemo-sort
import "dotenv/config";
import { writeFileSync } from "node:fs";
import type { Page } from "playwright-core";
import { analyzeReport } from "../src/server/ai/analyze.ts";
import type { NebiusConfig } from "../src/server/ai/nebius.ts";
import { runAgentSession, scriptedSignIn, type SignIn } from "../src/server/browser/session.ts";
import { buildLogs, describeUserAgent } from "../src/shared/logs.ts";
import type { LayoutAudit } from "../src/shared/page-runtime";
import type { Analysis, Breakpoint, Frame } from "../src/shared/schemas.ts";
import { launchBrowser, recordingContext, RUNTIME_SOURCE, shot, VIEWPORT } from "./driver.ts";

type Case = {
  id: string;
  site: string;
  /** What the person recording would write. */
  note: string;
  origin: string;
  start: string;
  signIn?: SignIn;
  record?: ((page: Page) => Promise<unknown>)[];
  /** Layout scan instead of a recording. */
  scanWidths?: number[];
  /** The report should mention this. */
  expect: RegExp;
  /** Not a bug: the agent should say "not reproduced". */
  control?: boolean;
};

const SAUCE = "https://www.saucedemo.com";
const sauceUser = (user: string): SignIn => ({ path: "/", email: user, password: "secret_sauce" });

const CASES: Case[] = [
  {
    id: "saucedemo-sort",
    site: "saucedemo.com (problem_user)",
    note: "Sorting products by price does nothing",
    origin: SAUCE,
    start: "/inventory.html",
    signIn: sauceUser("problem_user"),
    record: [(p) => p.selectOption(".product_sort_container", "lohi"), (p) => p.waitForTimeout(500)],
    expect: /sort|order|price/i,
  },
  {
    id: "saucedemo-images",
    site: "saucedemo.com (problem_user)",
    note: "All the product pictures show the same dog",
    origin: SAUCE,
    start: "/inventory.html",
    signIn: sauceUser("problem_user"),
    record: [(p) => p.mouse.wheel(0, 500), (p) => p.waitForTimeout(400)],
    expect: /image|picture|photo|sl-404|same/i,
  },
  {
    id: "saucedemo-add-to-cart",
    site: "saucedemo.com (error_user)",
    note: "Add to cart throws an error on some products",
    origin: SAUCE,
    start: "/inventory.html",
    signIn: sauceUser("error_user"),
    record: [(p) => p.click("#add-to-cart-sauce-labs-backpack"), (p) => p.click("#add-to-cart-sauce-labs-bolt-t-shirt"), (p) => p.waitForTimeout(400)],
    expect: /cart|failed|error/i,
  },
  {
    id: "the-internet-js-error",
    site: "the-internet.herokuapp.com",
    note: "This page throws an error as soon as it loads",
    origin: "https://the-internet.herokuapp.com",
    start: "/javascript_error",
    record: [(p) => p.reload(), (p) => p.waitForTimeout(500)],
    expect: /error|undefined|xyz|onload/i,
  },
  {
    id: "the-internet-broken-images",
    site: "the-internet.herokuapp.com",
    note: "Two of the images on this page are broken",
    origin: "https://the-internet.herokuapp.com",
    start: "/broken_images",
    record: [(p) => p.reload(), (p) => p.waitForTimeout(800)],
    expect: /asdf|hjkl|404|broken|image/i,
  },
  {
    id: "saucedemo-visual-layout",
    site: "saucedemo.com (visual_user)",
    note: "Product cards look misaligned",
    origin: SAUCE,
    start: "/inventory.html",
    signIn: sauceUser("visual_user"),
    scanWidths: [390, 768, 1280],
    expect: /align|misalign|position|button|layout|overlap|cart/i,
  },
  {
    id: "todomvc-control",
    site: "demo.playwright.dev/todomvc",
    note: "I can't add a new todo",
    origin: "https://demo.playwright.dev",
    start: "/todomvc/#/",
    expect: /.^/,
    control: true,
  },
];

const apiKey = process.env.NEBIUS_API_KEY;
if (!apiKey) {
  console.error("✗ NEBIUS_API_KEY is not set.");
  process.exit(1);
}
const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined;
const config: NebiusConfig = { apiKey, baseURL: process.env.NEBIUS_BASE_URL || "https://api.tokenfactory.us-north1.nebius.com/v1/", model: process.env.NEBIUS_MODEL || "MiniMaxAI/MiniMax-M3.1-Flash" };
const call = (fn: string) => `(function(){${RUNTIME_SOURCE};return ${fn}();})()`;

type Result = { id: string; site: string; note: string; reportOk: boolean | null; reportSeconds?: number; title?: string; cause?: string; layout?: Analysis["layout"]; agent?: { reproduced: boolean | null; steps: number; evidence: string; seconds: number }; ok: boolean; error?: string };

async function runCase(c: Case): Promise<Result> {
  const browser = await launchBrowser();
  try {
    let analysis: Analysis;
    const t0 = Date.now();
    if (c.control) {
      analysis = { title: c.note, summary: "", severity: "medium", steps: [{ t: 0, action: 'Type "Buy milk" into the new-todo field and press Enter' }], expected: "The todo appears in the list", actual: "Nothing is added", suspectedCause: "", evidence: [], security: [], layout: [] };
    } else {
      const { context, events } = await recordingContext(browser);
      const page = await context.newPage();
      if (c.signIn) await scriptedSignIn(page, c.origin, c.signIn);
      await page.goto(`${c.origin}${c.start}`);
      await page.waitForTimeout(800);
      const ua = await page.evaluate(() => navigator.userAgent);
      const device = { userAgent: ua, ...describeUserAgent(ua), viewport: VIEWPORT, pixelRatio: 1, language: "en-US", timezone: "UTC", pageTitle: await page.title() };
      if (c.scanWidths) {
        const breakpoints: Breakpoint[] = [];
        for (const width of c.scanWidths) {
          await page.setViewportSize({ width, height: 900 });
          await page.waitForTimeout(500);
          breakpoints.push({ width, height: 900, url: await shot(page), audit: (await page.evaluate(call("layoutAudit"))) as LayoutAudit });
        }
        analysis = await analyzeReport(config, { note: c.note, pageUrl: page.url(), frames: breakpoints.map((b, i) => ({ t: i, url: b.url })), breakpoints, logs: { console: [], network: [], actions: [] }, device });
      } else {
        const startTs = Date.now();
        const frames: Frame[] = [{ t: 0, url: await shot(page) }];
        for (const step of c.record ?? []) {
          await step(page);
          await page.waitForTimeout(500);
          frames.push({ t: Math.round((Date.now() - startTs) / 100) / 10, url: await shot(page) });
        }
        analysis = await analyzeReport(config, { note: c.note, pageUrl: page.url(), durationMs: Date.now() - startTs, frames, logs: buildLogs(events, startTs), device });
      }
      await context.close();
    }
    const reportSeconds = (Date.now() - t0) / 1000;
    const text = `${analysis.title} ${analysis.summary} ${analysis.suspectedCause} ${analysis.actual} ${analysis.layout.map((l) => `${l.element} ${l.issue}`).join(" ")}`;
    const reportOk = c.control ? null : c.expect.test(text);

    let agent: Result["agent"];
    if (!c.scanWidths) {
      const a0 = Date.now();
      const s = await runAgentSession(config, { appUrl: c.origin, startPath: c.start, goal: { title: analysis.title, analysis }, signIn: c.signIn, maxSteps: 15 });
      agent = { reproduced: s.reproduced, steps: s.steps, evidence: s.evidence, seconds: (Date.now() - a0) / 1000 };
    }
    const ok = c.control ? agent?.reproduced === false : Boolean(reportOk) && (agent ? agent.reproduced === true : analysis.layout.length > 0);
    return { id: c.id, site: c.site, note: c.note, reportOk, reportSeconds, title: analysis.title, cause: analysis.suspectedCause, layout: analysis.layout, agent, ok };
  } catch (e) {
    return { id: c.id, site: c.site, note: c.note, reportOk: false, ok: false, error: String((e as Error).message).slice(0, 300) };
  } finally {
    await browser.close();
  }
}

const results: Result[] = [];
for (const c of CASES.filter((x) => !only || x.id === only)) {
  const r = await runCase(c);
  results.push(r);
  console.log(`${r.ok ? "✓" : "✗"} ${c.id.padEnd(28)} ${r.error ? `error: ${r.error}` : `report ${r.reportOk === null ? "control" : r.reportOk ? "✓" : "✗"} "${r.title}"${r.agent ? ` | agent ${r.agent.reproduced} in ${r.agent.steps} steps` : ` | ${r.layout?.length ?? 0} layout findings`}`}`);
}

const md = [
  "# Repro on real sites",
  "",
  `${new Date().toISOString().slice(0, 10)} · ${config.model} · public test sites with bugs in their own code. Run with \`pnpm bench:real\`.`,
  "",
  "| Case | Site | Reporter's note | Report | Agent | Result |",
  "| --- | --- | --- | --- | --- | --- |",
  ...results.map(
    (r) =>
      `| ${r.id} | ${r.site} | ${r.note} | ${r.error ? `error: ${r.error.slice(0, 60)}` : (r.title ?? "").replace(/\|/g, "/")} | ${r.agent ? `${r.agent.reproduced === null ? "no conclusion" : r.agent.reproduced ? "reproduced" : "not reproduced"} (${r.agent.steps} steps)` : `${r.layout?.length ?? 0} layout findings`} | ${r.ok ? "✓" : "✗"} |`,
  ),
  "",
  `${results.filter((r) => r.ok).length}/${results.length} as expected (the control should come back "not reproduced").`,
  "",
].join("\n");
writeFileSync(new URL("./real-results.json", import.meta.url), JSON.stringify(results, null, 2));
writeFileSync(new URL("./real-results.md", import.meta.url), md);
console.log(`\n${md}`);
