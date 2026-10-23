// "Check this fix in a sandbox": run the project's tests and the reproduce agent on the original code and
// on the patched copy. A fix is verified when the patched tests pass and the agent can't reproduce the bug.
import type { Edit } from "../ai/fix";
import type { NebiusConfig } from "../ai/nebius";
import { runAgentSession, type SessionResult, type SignIn } from "../browser/session";
import type { Analysis } from "@/shared/schemas";
import { detectProvider, prepareWorkspace, runCommand, startApp, type CommandResult, type Provider } from "./index";

export type SandboxTarget = {
  from: { dir: string } | { tarball: Buffer };
  checkCommand?: string | null;
  startCommand?: string | null;
  appPort?: number | null;
  /** Path and query of the page the bug is on, e.g. /checkout. */
  startPath: string;
  signIn?: SignIn;
};

type Side = { tests?: CommandResult; agent?: Omit<SessionResult, "screenshot"> & { screenshot?: string } };
export type SandboxReport = { provider: Provider; before: Side; after: Side; verified: boolean; summary: string };

export async function checkFixInSandbox(
  config: NebiusConfig,
  target: SandboxTarget,
  fix: { edits: Edit[]; analysis: Analysis; title: string },
  opts: { onProgress?: (text: string) => void; skipBefore?: boolean } = {},
): Promise<SandboxReport> {
  const progress = opts.onProgress ?? (() => {});
  if (!target.checkCommand && !target.startCommand) throw new Error("Set a test command or a start command on the project to use the sandbox.");
  const provider = await detectProvider();
  progress(provider === "docker" ? "Sandbox: Docker container (node:22, 2 CPUs, 2 GB)" : "Sandbox: local process (Docker isn't running, so this isn't isolated)");
  const result: SandboxReport = { provider, before: {}, after: {}, verified: false, summary: "" };

  for (const side of opts.skipBefore ? (["after"] as const) : (["before", "after"] as const)) {
    const label = side === "before" ? "original code" : "with the fix";
    const ws = await prepareWorkspace(target.from, side === "after" ? fix.edits : []);
    try {
      if (target.checkCommand) {
        progress(`Running \`${target.checkCommand}\` on the ${label}…`);
        const tests = await runCommand(ws.dir, target.checkCommand, { provider });
        result[side].tests = tests;
        progress(`Tests on the ${label}: ${tests.exitCode === 0 ? "pass" : `fail (exit ${tests.exitCode})`}`);
      }
      if (target.startCommand && target.appPort) {
        progress(`Starting the app (${label})…`);
        const app = await startApp(ws.dir, target.startCommand, target.appPort, { provider });
        try {
          progress(`Reproducing on the ${label}…`);
          const session = await runAgentSession(config, {
            appUrl: app.url,
            startPath: target.startPath,
            goal: { title: fix.title, analysis: fix.analysis, purpose: side === "after" ? "verify" : "reproduce" },
            signIn: target.signIn,
            maxSteps: 15,
            onStep: (t) => progress(`  ${t}`),
          });
          result[side].agent = session;
          progress(`Agent on the ${label}: ${session.reproduced === true ? "bug reproduced" : session.reproduced === false ? "bug not reproduced" : "no conclusion"}`);
        } finally {
          await app.stop();
        }
      }
    } finally {
      await ws.cleanup();
    }
  }

  const testsOk = result.after.tests ? result.after.tests.exitCode === 0 : true;
  const agentOk = result.after.agent ? result.after.agent.reproduced === false : true;
  result.verified = testsOk && agentOk;
  result.summary = [
    result.after.tests && `tests ${testsOk ? "pass" : "still fail"}${result.before.tests ? ` (before: ${result.before.tests.exitCode === 0 ? "pass" : "fail"})` : ""}`,
    result.after.agent && `agent ${agentOk ? "can no longer reproduce the bug" : "still reproduces it"}${result.before.agent ? ` (before: ${result.before.agent.reproduced ? "reproduced" : "not reproduced"})` : ""}`,
  ]
    .filter(Boolean)
    .join("; ");
  progress(`${result.verified ? "Fix verified" : "Not verified"}: ${result.summary}`);
  return result;
}
