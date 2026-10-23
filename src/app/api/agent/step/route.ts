import { agentStepRequestSchema, elementLabel, LIMITS, riskyActionPrompt, type AgentStepResponse } from "@/shared/schemas";
import { nextAction, startHistory } from "@/server/ai/agent";
import { aiConfig, apiError, apiUser, spendAi, storage } from "@/server/request";
import { getReport } from "@/server/services/reports";
import { addEvent, createRun, getRun, updateRun } from "@/server/services/runs";

export const maxDuration = 120;

/**
 * One step of a reproduce run, driven by the extension: it sends what the tab looks like now and gets
 * back the next action. Omit runId (and send reportId) to start a run.
 */
export async function POST(request: Request) {
  const user = await apiUser(request);
  if (!user) return apiError(401, "Not paired. Open Connect in Repro to pair this extension.");
  const parsed = agentStepRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(400, "Bad step request", { issues: parsed.error.issues.slice(0, 5) });
  const { observation } = parsed.data;

  let run;
  if (parsed.data.runId) {
    run = await getRun(parsed.data.runId, user.id);
    if (!run) return apiError(404, "Run not found");
    if (run.status !== "running") return apiError(409, run.status === "stopped" ? "Stopped" : "This run has finished", { status: run.status });
  } else {
    const report = parsed.data.reportId ? await getReport(parsed.data.reportId, user.id) : null;
    if (!report) return apiError(404, "Report not found");
    const purpose = parsed.data.purpose ?? "reproduce";
    run = await createRun(report.id, user.id, startHistory({ pageUrl: report.pageUrl, title: report.note || report.title, analysis: report.analysis, logs: report.logs, purpose }), purpose);
  }

  if (run.steps >= LIMITS.agentSteps) {
    const evidence = `Stopped after ${LIMITS.agentSteps} steps without a conclusion.`;
    await updateRun(run.id, { status: "done", reproduced: false, summary: evidence });
    await addEvent(run.id, "done", { reproduced: false, evidence });
    return Response.json({ runId: run.id, step: run.steps, action: { type: "done", reproduced: false, evidence } } satisfies AgentStepResponse);
  }
  const denied = await spendAi(user, "agentStep");
  if (denied) return denied;

  const screenshotUrl = await storage()
    .put(Buffer.from(observation.screenshot.split(",")[1] ?? "", "base64"), "image/jpeg")
    .catch(() => undefined);
  await addEvent(run.id, "observation", { url: observation.url, title: observation.title, lastResult: observation.lastResult, consoleErrors: observation.consoleErrors }, screenshotUrl);

  let turn;
  try {
    turn = await nextAction(aiConfig(), run.history, observation);
  } catch (e) {
    const message = (e as Error).message || "The model didn't answer";
    await updateRun(run.id, { status: "failed", summary: message });
    await addEvent(run.id, "error", { message });
    return apiError(502, message);
  }

  const step = run.steps + 1;
  const action = turn.action;
  const confirm = riskyActionPrompt(action, observation.elements);
  await updateRun(run.id, {
    history: turn.history,
    steps: step,
    inputTokens: run.inputTokens + turn.usage.input,
    outputTokens: run.outputTokens + turn.usage.output,
    ...(action.type === "done" ? { status: "done" as const, reproduced: action.reproduced, summary: action.evidence } : {}),
    // No verdict: a verify run that couldn't check must never read as "fix verified".
    ...(action.type === "give_up" ? { status: "failed" as const, summary: `Couldn't finish: ${action.reason}` } : {}),
  });
  if (action.type === "give_up") await addEvent(run.id, "error", { message: `Couldn't finish: ${action.reason}` });
  else
    await addEvent(run.id, action.type === "done" ? "done" : "action", action.type === "done" ? { ...action, thought: turn.thought } : { action, thought: turn.thought, confirm, target: "id" in action ? elementLabel(action.id, observation.elements) : undefined });
  return Response.json({ runId: run.id, step, action, thought: turn.thought, confirm } satisfies AgentStepResponse);
}
