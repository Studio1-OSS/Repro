// The reproduce agent: one observation in (screenshot + numbered elements), one browser action out.
// Drivers (the extension via CDP, the bench via Playwright) run the action and call this again.
// No server-only imports: the bench runs this exact code.
import { agentActionSchema, blockedActionReason, LIMITS, type AgentAction, type AgentObservation, type Analysis, type ReportLogs } from "@/shared/schemas";
import { formatLogs } from "./analyze";
import { chatTools, cleanModelJson, type Message, type NebiusConfig, type Tool, type Usage } from "./nebius";

const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[]): Tool => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } },
});

export const AGENT_TOOLS: Tool[] = [
  fn("click", "Click the element with this [id] from the element list.", { id: { type: "integer" } }, ["id"]),
  fn(
    "click_at",
    "Click at a point on the screenshot (x, y in screenshot pixels). Only for things the element list doesn't show, like a canvas, a map or a custom widget.",
    { x: { type: "number" }, y: { type: "number" } },
    ["x", "y"],
  ),
  fn(
    "type",
    "Replace the value of input [id] with text. Set submit to press Enter afterwards.",
    { id: { type: "integer" }, text: { type: "string" }, submit: { type: "boolean" } },
    ["id", "text"],
  ),
  fn("select", "Choose an option in a dropdown (<select>) [id] by its visible text, e.g. \"Price (low to high)\".", { id: { type: "integer" }, option: { type: "string" } }, ["id", "option"]),
  fn("press", "Press a key on the focused element, e.g. Enter, Escape, Tab, ArrowDown.", { key: { type: "string" } }, ["key"]),
  fn("scroll", "Scroll the page one screen up or down to find more elements.", { direction: { type: "string", enum: ["up", "down"] } }, ["direction"]),
  fn("navigate", "Open a URL on the same site.", { url: { type: "string" } }, ["url"]),
  fn("wait", "Wait for the page to update (milliseconds, 100–5000).", { ms: { type: "integer" } }, ["ms"]),
  fn(
    "give_up",
    "Stop without a verdict when you can't continue: a sign-in page, a CAPTCHA, two-factor auth, or anything the rules forbid. Say why.",
    { reason: { type: "string" } },
    ["reason"],
  ),
  fn(
    "done",
    "Finish. reproduced=true only when you saw the reported bug happen on screen or in the console; evidence says exactly what you saw.",
    { reproduced: { type: "boolean" }, evidence: { type: "string" } },
    ["reproduced", "evidence"],
  ),
];

export const AGENT_SYSTEM_PROMPT = `You reproduce bug reports by operating a real browser tab that is already signed in as the user.
Each turn you get a screenshot, the page's interactive elements as "[id] role "label"", visible text and any new console errors. Call exactly one tool per turn.

Rules:
- You're already signed in. Skip any sign-in steps and never type passwords. If you land on a sign-in page, a CAPTCHA or two-factor auth, call give_up: never try to get around a blocked action (for example by pressing keys one at a time).
- Follow the reported steps with the same values. Don't explore beyond what the steps need.
- The report's wording can be slightly off. If the core symptom happens (e.g. the list doesn't re-sort, the total is wrong, the save is lost), it's reproduced, even if a detail differs.
- Use element ids from the latest list only. If what you need isn't listed, scroll; if it's drawn (canvas, map, chart), use click_at with screenshot coordinates.
- Never enter real payment details or passwords, and never confirm irreversible actions the steps don't require.
- As soon as you see the bug (the wrong value, error message or broken state the report describes), call done with reproduced=true and the evidence. A control that ignores your input, or a page that doesn't react, can itself be the bug: don't keep retrying the same thing.
- If you followed every step and the bug didn't happen, call done with reproduced=false and what you saw instead.
- You have at most ${LIMITS.agentSteps} steps.`;

export type AgentGoal = {
  pageUrl: string;
  purpose?: "reproduce" | "verify";
  title: string;
  analysis?: Analysis | null;
  /** Used when there's no analysis yet. */
  logs?: ReportLogs;
};

export function goalMessage(goal: AgentGoal): string {
  const a = goal.analysis;
  if (a && goal.purpose === "verify") {
    return [
      `A fix was just applied for this bug: ${a.title}`,
      `Start page: ${goal.pageUrl}`,
      "Follow the same steps:",
      ...a.steps.map((s, i) => `${i + 1}. ${s.action}`),
      `Expected (correct behaviour): ${a.expected}`,
      `The bug was: ${a.actual}`,
      "Check whether the bug still happens. Call done with reproduced=true only if you still see it; reproduced=false with what you saw if it's fixed.",
    ].join("\n");
  }
  if (a) {
    return [
      `Bug report: ${a.title}`,
      `Start page: ${goal.pageUrl}`,
      "Steps:",
      ...a.steps.map((s, i) => `${i + 1}. ${s.action}`),
      `Expected: ${a.expected}`,
      `Actual (the bug): ${a.actual}`,
      "Reproduce it.",
    ].join("\n");
  }
  return [`Bug report: ${goal.title}`, `Start page: ${goal.pageUrl}`, "What the user did:", goal.logs ? formatLogs(goal.logs) : "(no log)", "Reproduce it."].join("\n");
}

export function startHistory(goal: AgentGoal): Message[] {
  return [
    { role: "system", content: AGENT_SYSTEM_PROMPT },
    { role: "user", content: goalMessage(goal) },
  ];
}

/** Keeps only the newest screenshots in the prompt; older ones become a one-line note. */
export function trimScreenshots(history: Message[], keep: number = LIMITS.agentScreenshots): Message[] {
  let seen = 0;
  const out = [...history];
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i];
    if (m.role !== "user" || !Array.isArray(m.content) || !m.content.some((p) => p.type === "image_url")) continue;
    if (++seen > keep) out[i] = { role: "user", content: m.content.filter((p) => p.type !== "image_url").concat({ type: "text", text: "[older screenshot removed]" }) };
  }
  return out;
}

function observationMessage(o: AgentObservation): Message {
  const text = [
    `URL: ${o.url}${o.title ? ` (${o.title})` : ""}`,
    o.consoleErrors.length ? `New console errors:\n${o.consoleErrors.map((e) => `- ${e}`).join("\n")}` : "",
    `Elements:\n${o.elements || "(none found)"}`,
    o.text ? `Visible text: ${o.text}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return { role: "user", content: [{ type: "text", text }, { type: "image_url", image_url: { url: o.screenshot } }] };
}

/** Turns a tool call (or a JSON action written as text) into a validated action. */
export function parseAction(name: string | undefined, args: string): AgentAction | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(args || "{}");
  } catch {
    return null;
  }
  const candidate = name ? { type: name, ...(parsed as object) } : parsed;
  const result = agentActionSchema.safeParse(candidate);
  return result.success ? result.data : null;
}

/** The model's reasoning, cut to a line for the live view. */
const toThought = (reasoning: string, content: string) => {
  const text = (reasoning || content).replace(/\s+/g, " ").trim();
  return text.length > 220 ? `${text.slice(0, 217)}…` : text || undefined;
};

export type AgentTurn = { action: AgentAction; thought?: string; history: Message[]; usage: Usage };

export async function nextAction(config: NebiusConfig, history: Message[], observation: AgentObservation): Promise<AgentTurn> {
  let messages = [...history];
  // The previous turn's tool call needs its result before the next observation.
  const last = messages.at(-1);
  if (last?.role === "assistant" && last.tool_calls?.length) {
    messages.push({ role: "tool", tool_call_id: last.tool_calls[0].id, content: observation.lastResult ?? "ok" });
  }
  messages.push(observationMessage(observation));
  // The same action three times in a row means the agent is stuck: ask it to decide.
  const recent = messages.flatMap((m) => (m.role === "assistant" && m.tool_calls?.[0]?.type === "function" ? [`${m.tool_calls[0].function.name}:${m.tool_calls[0].function.arguments}`] : [])).slice(-3);
  if (recent.length === 3 && new Set(recent).size === 1) {
    messages.push({ role: "user", content: "You've done the same action three times and the page isn't changing. If that matches the report, the bug is reproduced: call done. Otherwise try something different." });
  }
  messages = trimScreenshots(messages);

  const usage: Usage = { input: 0, output: 0 };
  for (let attempt = 0; attempt < 3; attempt++) {
    const turn = await chatTools(config, { messages, tools: AGENT_TOOLS, effort: "low" });
    usage.input += turn.usage.input;
    usage.output += turn.usage.output;
    // Native tool call, or the same action written as JSON text.
    const action = turn.call ? parseAction(turn.call.name, turn.call.arguments) : parseAction(undefined, cleanModelJson(turn.content));
    if (action) {
      const call = turn.call ?? { id: `call_${messages.length}`, name: action.type, arguments: JSON.stringify(action) };
      messages.push({ role: "assistant", content: "", tool_calls: [{ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } }] });
      const blocked = blockedActionReason(action, observation.elements);
      if (!blocked) return { action, thought: toThought(turn.reasoning, turn.content), history: messages, usage };
      messages.push({ role: "tool", tool_call_id: call.id, content: blocked });
      continue;
    }
    if (turn.call) {
      messages.push(
        { role: "assistant", content: "", tool_calls: [{ id: turn.call.id, type: "function", function: { name: turn.call.name, arguments: turn.call.arguments } }] },
        { role: "tool", tool_call_id: turn.call.id, content: `Invalid arguments for ${turn.call.name}: ${turn.call.arguments}. Check the tool's parameters.` },
      );
    } else {
      messages.push({ role: "assistant", content: turn.content || "(no tool call)" }, { role: "user", content: "Call exactly one tool." });
    }
  }
  throw new Error("The agent didn't choose a valid action.");
}
