// The Repro bench. For each seeded bug in the bench fixture (bench/app): record it like a user would,
// have the model write the report, let the agent reproduce it in a fresh signed-in tab, and with --fix
// have the model fix the source and verify the fix in the sandbox. Same code paths as the app.
//
//   pnpm bench                       # report + reproduce, all bugs
//   pnpm bench --fix                 # also fix and verify each bug in the sandbox
//   pnpm bench --only coupon-nan     # one bug
//   pnpm bench --model <model-id>    # try another model on Token Factory
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { analyzeReport, formatLogs } from "../src/server/ai/analyze.ts";
import { proposeFix, type FixProposal } from "../src/server/ai/fix.ts";
import type { NebiusConfig } from "../src/server/ai/nebius.ts";
import { runAgentSession, scriptedSignIn } from "../src/server/browser/session.ts";
import { checkFixInSandbox, type SandboxReport } from "../src/server/sandbox/check.ts";
import { prepareWorkspace, startApp, detectProvider } from "../src/server/sandbox/index.ts";
import { localSource } from "../src/server/source/local.ts";
import { buildLogs, describeUserAgent } from "../src/shared/logs.ts";
import type { LayoutAudit } from "../src/shared/page-runtime";
import type { Analysis, Breakpoint, Frame, ReportLogs } from "../src/shared/schemas.ts";
import { LOGIN, startServer } from "./app/server.mjs";
import { BUGS, type BenchBug } from "./bugs.ts";
import { launchBrowser, recordingContext, RUNTIME_SOURCE, shot, VIEWPORT, type Browser } from "./driver.ts";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const apiKey = process.env.NEBIUS_API_KEY;
if (!apiKey) {
  console.error("✗ NEBIUS_API_KEY is not set. Add it to .env first.");
  process.exit(1);
}
const model = flag("--model") || process.env.NEBIUS_MODEL || "MiniMaxAI/MiniMax-M3.1-Flash";
const baseURL = process.env.NEBIUS_BASE_URL || "https://api.tokenfactory.us-north1.nebius.com/v1/";
const only = flag("--only");
const withFix = args.includes("--fix");
const bugs = BUGS.filter((b) => !only || b.id === only);
const APP_DIR = fileURLToPath(new URL("./app/", import.meta.url));
const SIGN_IN = { path: "/login", email: LOGIN.email, password: LOGIN.password };

type Tokens = { input: number; output: number };
const meter = (tokens: Tokens): NebiusConfig => ({
  apiKey,
  baseURL,
  model,
  onUsage: (u) => {
    tokens.input += u.prompt_tokens;
    tokens.output += u.completion_tokens;
  },
});
const call = (fn: string) => `(function(){${RUNTIME_SOURCE};return ${fn}();})()`;

type Result = {
  id: string;
  title: string;
  kind: "bug" | "responsive" | "control";
  analysis?: { ms: number; tokens: Tokens; stepsOk: boolean; causeOk: boolean; securityOk: boolean | null; report: Analysis } | { error: string };
  agent?: { ms: number; tokens: Tokens; steps: number; reproducedClaim: boolean | null; verifiedOnPage: boolean; success: boolean; evidence: string; trace: string[] };
  fix?: { ms: number; tokens: Tokens; files: string[]; wholeRepo: boolean; diff: string; explanation: string; verified: boolean; summary: string; sandbox?: SandboxReport } | { error: string };
};

/** Records the bug like a user: frames after each action, the page's logs. */
async function record(browser: Browser, base: string, bug: BenchBug) {
  const { context, events } = await recordingContext(browser);
  const page = await context.newPage();
  await scriptedSignIn(page, base, SIGN_IN);
  await page.goto(`${base}${bug.start}`);
  await page.waitForTimeout(300);
  const startTs = Date.now();
  const frames: Frame[] = [{ t: 0, url: await shot(page) }];
  for (const step of bug.record) {
    await step(page);
    await page.waitForTimeout(700);
    frames.push({ t: Math.round((Date.now() - startTs) / 100) / 10, url: await shot(page) });
  }
  const ua = await page.evaluate(() => navigator.userAgent);
  const out = {
    frames,
    durationMs: Date.now() - startTs,
    logs: buildLogs(events, startTs),
    device: { userAgent: ua, ...describeUserAgent(ua), viewport: VIEWPORT, pixelRatio: 1, language: "en-US", timezone: "UTC", pageTitle: await page.title() },
  };
  await context.close();
  return out;
}

/** A responsive scan like the extension's: screenshot and layout audit at each width. */
async function scan(browser: Browser, base: string, bug: BenchBug): Promise<Breakpoint[]> {
  const page = await browser.newPage();
  await scriptedSignIn(page, base, SIGN_IN);
  const out: Breakpoint[] = [];
  for (const width of bug.responsive!.widths) {
    const height = width < 768 ? 800 : 900;
    await page.setViewportSize({ width, height });
    await page.goto(`${base}${bug.start}`);
    await page.waitForTimeout(300);
    const audit = (await page.evaluate(call("layoutAudit"))) as LayoutAudit;
    out.push({ width, height, url: await shot(page), audit });
  }
  await page.close();
  return out;
}

async function overflowAt(base: string, path: string, width: number): Promise<number> {
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width, height: 800 } });
  await scriptedSignIn(page, base, SIGN_IN);
  await page.goto(`${base}${path}`);
  const audit = (await page.evaluate(call("layoutAudit"))) as LayoutAudit;
  await browser.close();
  return audit.overflowX;
}

async function runBug(browser: Browser, base: string, bug: BenchBug): Promise<Result> {
  const kind: Result["kind"] = bug.control ? "control" : bug.responsive ? "responsive" : "bug";
  const result: Result = { id: bug.id, title: bug.title, kind };
  let analysis: Analysis;
  let logs: ReportLogs = { console: [], network: [], actions: [] };

  // 1. The report.
  if (bug.control) {
    analysis = { title: bug.title, summary: "", severity: "medium", steps: bug.control.steps.map((action, i) => ({ t: i, action })), expected: bug.control.expected, actual: bug.control.actual, suspectedCause: "", evidence: [], security: [], layout: [] };
  } else {
    const tokens = { input: 0, output: 0 };
    const t0 = Date.now();
    try {
      if (bug.responsive) {
        const breakpoints = await scan(browser, base, bug);
        const ua = "Mozilla/5.0 (Macintosh) Chrome/141";
        analysis = await analyzeReport(meter(tokens), {
          note: bug.title,
          pageUrl: `${base}${bug.start}`,
          frames: breakpoints.map((b, i) => ({ t: i, url: b.url })),
          breakpoints,
          logs,
          device: { userAgent: ua, ...describeUserAgent(ua), viewport: VIEWPORT, pixelRatio: 1, language: "en-US", timezone: "UTC" },
        });
      } else {
        const rec = await record(browser, base, bug);
        logs = rec.logs;
        analysis = await analyzeReport(meter(tokens), { note: bug.title, pageUrl: `${base}${bug.start}`, durationMs: rec.durationMs, frames: rec.frames, logs: rec.logs, device: rec.device });
      }
    } catch (e) {
      result.analysis = { error: String(e) };
      return result;
    }
    const causeText = `${analysis.suspectedCause} ${analysis.evidence.join(" ")} ${analysis.layout.map((l) => `${l.element} ${l.issue} ${l.suggestion}`).join(" ")}`;
    result.analysis = {
      ms: Date.now() - t0,
      tokens,
      stepsOk: bug.responsive ? analysis.layout.length > 0 : analysis.steps.length > 0,
      causeOk: bug.cause.test(causeText),
      securityOk: bug.security ? analysis.security.some((s) => bug.security!.test(`${s.issue} ${s.evidence}`)) : null,
      report: analysis,
    };
  }

  // 2. Reproduce in a fresh signed-in tab (layout bugs are checked by measuring instead).
  if (!bug.responsive) {
    const t0 = Date.now();
    let verifiedOnPage = false;
    const session = await runAgentSession(meter({ input: 0, output: 0 }), {
      appUrl: base,
      startPath: bug.start,
      goal: { title: analysis.title, analysis },
      signIn: SIGN_IN,
      afterRun: async (page) => {
        verifiedOnPage = await bug.check(page).catch(() => false);
      },
    });
    result.agent = {
      ms: Date.now() - t0,
      tokens: session.tokens,
      steps: session.steps,
      reproducedClaim: session.reproduced,
      verifiedOnPage,
      success: bug.control ? session.reproduced === false : session.reproduced === true && verifiedOnPage,
      evidence: session.evidence,
      trace: session.trace,
    };
  }

  // 3. Fix it and verify the fix in the sandbox.
  if (withFix && !bug.control) {
    const tokens = { input: 0, output: 0 };
    const t0 = Date.now();
    try {
      const proposal: FixProposal = await proposeFix(meter(tokens), localSource(APP_DIR), {
        title: analysis.title,
        pageUrl: `${base}${bug.start}`,
        note: bug.title,
        analysis,
        logs: formatLogs(logs),
        reproduced: result.agent?.evidence,
      });
      let verified: boolean;
      let summary: string;
      let sandbox: SandboxReport | undefined;
      if (bug.responsive) {
        // Layout: boot the patched app and measure the overflow at the narrowest width.
        const provider = await detectProvider();
        const ws = await prepareWorkspace({ dir: APP_DIR }, proposal.edits);
        const app = await startApp(ws.dir, "node server.mjs", 4400, { provider });
        try {
          const overflow = await overflowAt(app.url, bug.start, bug.responsive.widths[0]);
          verified = bug.responsive.fixed(overflow);
          summary = `${overflow}px horizontal overflow at ${bug.responsive.widths[0]}px after the fix`;
        } finally {
          await app.stop();
          await ws.cleanup();
        }
      } else {
        sandbox = await checkFixInSandbox(
          meter(tokens),
          { from: { dir: APP_DIR }, checkCommand: `node --test --test-name-pattern="${bug.test}"`, startCommand: "node server.mjs", appPort: 4400, startPath: bug.start, signIn: SIGN_IN },
          { edits: proposal.edits, analysis, title: analysis.title },
          { skipBefore: true },
        );
        verified = sandbox.verified;
        summary = sandbox.summary;
      }
      result.fix = { ms: Date.now() - t0, tokens, files: [...new Set(proposal.edits.map((e) => e.path))], wholeRepo: proposal.wholeRepo, diff: proposal.diff, explanation: proposal.explanation, verified, summary, sandbox };
    } catch (e) {
      result.fix = { error: String((e as Error).message ?? e).slice(0, 500) };
    }
  }
  return result;
}

const server = await startServer(Number(process.env.BENCH_PORT || 4401));
const browser = await launchBrowser();
console.log(`Bench: ${bugs.length} cases on ${model}${withFix ? " (with fix + sandbox verify)" : ""}\n`);
const results: Result[] = [];
for (const bug of bugs) {
  const r = await runBug(browser, server.url, bug);
  results.push(r);
  const a = r.analysis && "report" in r.analysis ? r.analysis : undefined;
  const f = r.fix && "verified" in r.fix ? r.fix : undefined;
  console.log(
    `${bug.id.padEnd(26)} ` +
      (a ? `report ${(a.ms / 1000).toFixed(1)}s ${a.stepsOk ? "✓" : "✗"}steps ${a.causeOk ? "✓" : "✗"}cause${a.securityOk === null ? "" : ` ${a.securityOk ? "✓" : "✗"}security`} | ` : r.kind === "control" ? "control | " : `report failed (${(r.analysis as { error?: string })?.error?.slice(0, 80)}) | `) +
      (r.agent ? `agent ${r.agent.success ? "✓" : "✗"} ${r.agent.steps} steps ${(r.agent.ms / 1000).toFixed(1)}s` : "agent –") +
      (withFix && r.kind !== "control" ? ` | fix ${f ? `${f.verified ? "✓ verified" : "✗ not verified"} (${f.files.join(", ")}) ${(f.ms / 1000).toFixed(1)}s: ${f.summary}` : `✗ ${(r.fix as { error?: string })?.error ?? ""}`}` : ""),
  );
}
await browser.close();
server.close();

// ── Summary ─────────────────────────────────────────────────────────────────────────
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const avg = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);
const analysed = results.flatMap((r) => (r.analysis && "report" in r.analysis ? [r.analysis] : []));
const bugsOnly = results.filter((r) => r.kind === "bug");
const fixes = results.flatMap((r) => (r.fix && "verified" in r.fix ? [r.fix] : []));
const fixable = results.filter((r) => r.kind !== "control");
const summary = {
  model,
  date: new Date().toISOString().slice(0, 10),
  bugs: bugsOnly.length,
  responsive: results.filter((r) => r.kind === "responsive").length,
  controls: results.filter((r) => r.kind === "control").length,
  reportComplete: analysed.filter((a) => a.stepsOk).length,
  causeFound: analysed.filter((a) => a.causeOk).length,
  analysed: analysed.length,
  securityPlanted: analysed.filter((a) => a.securityOk !== null).length,
  securityFound: analysed.filter((a) => a.securityOk).length,
  reproduced: bugsOnly.filter((r) => r.agent?.success).length,
  controlsCorrect: results.filter((r) => r.kind === "control" && r.agent?.success).length,
  fixesVerified: withFix ? fixes.filter((f) => f.verified).length : null,
  fixAttempts: withFix ? fixable.length : null,
  avgReportSeconds: avg(analysed.map((a) => a.ms / 1000)),
  avgReportTokens: { input: avg(analysed.map((a) => a.tokens.input)), output: avg(analysed.map((a) => a.tokens.output)) },
  avgAgentSteps: avg(results.flatMap((r) => (r.agent ? [r.agent.steps] : []))),
  avgAgentSeconds: avg(results.flatMap((r) => (r.agent ? [r.agent.ms / 1000] : []))),
  avgAgentTokens: { input: avg(results.flatMap((r) => (r.agent ? [r.agent.tokens.input] : []))), output: avg(results.flatMap((r) => (r.agent ? [r.agent.tokens.output] : []))) },
  avgFixSeconds: withFix ? avg(fixes.map((f) => f.ms / 1000)) : null,
  avgFixTokens: withFix ? { input: avg(fixes.map((f) => f.tokens.input)), output: avg(fixes.map((f) => f.tokens.output)) } : null,
};

const yes = (v: boolean | null | undefined) => (v === null || v === undefined ? "–" : v ? "✓" : "✗");
const rows = results.map((r) => {
  const a = r.analysis && "report" in r.analysis ? r.analysis : undefined;
  const f = r.fix && "verified" in r.fix ? r.fix : undefined;
  const agentCell = r.kind === "control" ? (r.agent?.success ? "✓ said not reproduced" : "✗") : r.agent ? `${yes(r.agent.success)} (${r.agent.steps} steps)` : "– (measured)";
  return `| ${r.id} | ${r.kind === "control" ? "control" : yes(a?.stepsOk)} | ${r.kind === "control" ? "–" : yes(a?.causeOk)} | ${yes(a?.securityOk ?? null)} | ${agentCell} | ${withFix ? (r.kind === "control" ? "–" : f ? `${yes(f.verified)} ${f.files.join(", ")}` : "✗ error") : "not run"} |`;
});
const md = [
  `# Repro bench: ${model}`,
  "",
  `${summary.date} · ${summary.bugs} seeded bugs, ${summary.responsive} layout bug and ${summary.controls} control in the bench fixture (\`bench/app\`), run with \`pnpm bench${withFix ? " --fix" : ""}\`.`,
  "",
  "| Case | Report complete | Cause found | Planted security issue flagged | Reproduced by agent | Fix verified in sandbox |",
  "| --- | --- | --- | --- | --- | --- |",
  ...rows,
  "",
  `- Reports: ${summary.reportComplete}/${summary.analysed} complete, the real cause named in ${summary.causeFound}/${summary.analysed}, planted security issue flagged ${summary.securityFound}/${summary.securityPlanted}.`,
  `- Agent: reproduced ${summary.reproduced}/${summary.bugs} bugs (its claim and the page state both checked); the control answered correctly ${summary.controlsCorrect}/${summary.controls}.`,
  ...(withFix
    ? [
        `- Fixes: ${summary.fixesVerified}/${summary.fixAttempts} verified in the sandbox (the bug's failing test passes on the patched copy, and the agent can no longer reproduce it; the layout bug is measured instead).`,
        `- Average fix: ${summary.avgFixSeconds!.toFixed(1)}s including the sandbox check, ${Math.round(summary.avgFixTokens!.input).toLocaleString("en-US")} input / ${Math.round(summary.avgFixTokens!.output).toLocaleString("en-US")} output tokens.`,
      ]
    : []),
  `- Average report: ${summary.avgReportSeconds.toFixed(1)}s, ${Math.round(summary.avgReportTokens.input).toLocaleString("en-US")} input / ${Math.round(summary.avgReportTokens.output).toLocaleString("en-US")} output tokens.`,
  `- Average reproduce run: ${summary.avgAgentSteps.toFixed(1)} steps, ${summary.avgAgentSeconds.toFixed(1)}s, ${Math.round(summary.avgAgentTokens.input).toLocaleString("en-US")} input / ${Math.round(summary.avgAgentTokens.output).toLocaleString("en-US")} output tokens.`,
  ...(withFix ? ["", "## Fixes", ...fixes.map((f, i) => `\n### ${results.filter((r) => r.fix && "verified" in r.fix)[i].id}\n\n${f.explanation}\n\n\`\`\`diff\n${f.diff.trim()}\n\`\`\``)] : []),
  "",
].join("\n");

mkdirSync(new URL(".", import.meta.url), { recursive: true });
writeFileSync(new URL("./results.json", import.meta.url), JSON.stringify({ summary, results }, (k, v) => (k === "screenshot" ? undefined : v), 2));
writeFileSync(new URL("./results.md", import.meta.url), md);
console.log(`\n${md.split("\n## Fixes")[0]}`);
