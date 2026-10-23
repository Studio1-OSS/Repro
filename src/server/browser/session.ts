// Runs the reproduce agent in a headless browser: the bench uses it on the fixture, the sandbox uses it to
// check a fix before and after. Sign-in is scripted here (never typed by the model).
import { nextAction, startHistory, type AgentGoal } from "../ai/agent";
import type { NebiusConfig } from "../ai/nebius";
import { LIMITS, riskyActionPrompt, type AgentAction } from "@/shared/schemas";
import { launchBrowser, observe, perform, recordingContext, shot, type Page } from "./driver";

export type SignIn = { path: string; email: string; password: string };

export type SessionResult = {
  reproduced: boolean | null;
  evidence: string;
  steps: number;
  trace: string[];
  screenshot: string;
  tokens: { input: number; output: number };
  error?: string;
};

/** Fills the first email/text field and the password field on the sign-in page, then submits. */
export async function scriptedSignIn(page: Page, appUrl: string, signIn: SignIn) {
  await page.goto(new URL(signIn.path, appUrl).href);
  const email = page.locator('input[type=email], input[name*=email i], input[name*=user i], input[type=text]').first();
  await email.fill(signIn.email);
  await page.locator("input[type=password]").first().fill(signIn.password);
  await Promise.all([page.waitForLoadState("load").catch(() => {}), page.locator("input[type=password]").first().press("Enter")]);
  await page.waitForTimeout(600);
}

export async function runAgentSession(
  config: NebiusConfig,
  opts: {
    appUrl: string;
    startPath: string;
    goal: Omit<AgentGoal, "pageUrl">;
    signIn?: SignIn;
    maxSteps?: number;
    onStep?: (text: string) => void;
    /** Inspect the page after the run (the bench checks the bug is really visible). */
    afterRun?: (page: Page) => Promise<void>;
  },
): Promise<SessionResult> {
  const browser = await launchBrowser();
  const { context, events } = await recordingContext(browser);
  const tokens = { input: 0, output: 0 };
  const trace: string[] = [];
  let done: Extract<AgentAction, { type: "done" }> | undefined;
  let steps = 0;
  let error: string | undefined;
  const page = await context.newPage();
  try {
    if (opts.signIn) await scriptedSignIn(page, opts.appUrl, opts.signIn);
    const pageUrl = new URL(opts.startPath, opts.appUrl).href;
    await page.goto(pageUrl);
    let history = startHistory({ ...opts.goal, pageUrl });
    let lastResult: string | undefined;
    let since = Date.now();
    const meter: NebiusConfig = {
      ...config,
      onUsage: (u) => {
        tokens.input += u.prompt_tokens;
        tokens.output += u.completion_tokens;
        config.onUsage?.(u);
      },
    };
    while (steps < (opts.maxSteps ?? LIMITS.agentSteps)) {
      const observation = await observe(page, events, since, lastResult);
      since = Date.now();
      const turn = await nextAction(meter, history, observation);
      history = turn.history;
      steps++;
      trace.push(JSON.stringify(turn.action));
      opts.onStep?.(`${steps}. ${turn.action.type}${"id" in turn.action ? ` [${turn.action.id}]` : ""}${turn.thought ? `: ${turn.thought}` : ""}`);
      if (turn.action.type === "done") {
        done = turn.action;
        break;
      }
      if (turn.action.type === "give_up") {
        error = `Gave up: ${turn.action.reason}`;
        break;
      }
      // No real side effects in a sandbox or a fixture, so risky clicks go ahead; they're noted in the trace.
      if (riskyActionPrompt(turn.action, observation.elements)) trace.push("(risky click auto-approved)");
      lastResult = await perform(page, turn.action);
    }
    await opts.afterRun?.(page);
  } catch (e) {
    error = String((e as Error).message ?? e).slice(0, 300);
  }
  const screenshot = await shot(page).catch(() => "");
  await browser.close();
  return { reproduced: done ? done.reproduced : null, evidence: done?.evidence ?? error ?? "No conclusion within the step limit.", steps, trace, screenshot, tokens, error };
}
