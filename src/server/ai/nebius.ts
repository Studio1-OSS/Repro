// Nebius Token Factory adapter. Every model-specific option lives in this file, so swapping the model
// (NEBIUS_MODEL) or moving to another OpenAI-compatible provider means editing only here.
import OpenAI from "openai";
import type { z } from "zod";

export type NebiusConfig = {
  apiKey: string;
  baseURL: string;
  model: string;
  /** Optional token meter (the bench uses it to report cost). */
  onUsage?: (usage: OpenAI.Completions.CompletionUsage) => void;
};

export type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;
export type Content = OpenAI.Chat.Completions.ChatCompletionContentPart[];
export type Tool = OpenAI.Chat.Completions.ChatCompletionTool;
export type Usage = { input: number; output: number };

/** MiniMax-M3.1-Flash always reasons; this sets how much. */
export type ReasoningEffort = "low" | "medium" | "high";

export class AIError extends Error {
  constructor(
    message: string,
    readonly kind: "provider" | "invalid_output" | "truncated",
  ) {
    super(message);
    this.name = "AIError";
  }
}

let cached: { key: string; client: OpenAI } | undefined;
function getClient({ apiKey, baseURL }: NebiusConfig) {
  const key = `${baseURL}|${apiKey}`;
  if (cached?.key !== key) {
    cached = { key, client: new OpenAI({ apiKey, baseURL, maxRetries: 2, timeout: 300_000 }) };
  }
  return cached.client;
}

/** Sampling from the model card: temperature 1.0, top_p 0.95. */
const sampling = (effort: ReasoningEffort) => ({ temperature: 1, top_p: 0.95, reasoning_effort: effort });

/** Reasoning arrives as `reasoning_content` (MiniMax), `reasoning` (some routes) or inline <think> text. */
export function reasoningOf(message: unknown): string {
  const m = message as { reasoning_content?: string | null; reasoning?: string | null; content?: string | null };
  if (m.reasoning_content) return m.reasoning_content;
  if (m.reasoning) return m.reasoning;
  return m.content?.match(/<think>([\s\S]*?)(<\/think>|$)/i)?.[1]?.trim() ?? "";
}

/**
 * Pulls the JSON object out of a model reply: drops reasoning blocks and markdown fences, then returns the
 * last {...} block that actually parses (reasoning written before the answer can contain stray braces).
 */
export function cleanModelJson(raw: string): string {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  // An unterminated think block (thinking cut short): drop everything before the first "{".
  if (/<think>/i.test(text)) text = text.slice(text.indexOf("{"));
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const end = text.lastIndexOf("}");
  if (end < 0) return text;
  for (let start = text.indexOf("{"); start >= 0 && start < end; start = text.indexOf("{", start + 1)) {
    const candidate = text.slice(start, end + 1);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // Not valid from here: try the next "{".
    }
  }
  const start = text.indexOf("{");
  return start >= 0 ? text.slice(start, end + 1) : text;
}

const providerError = (error: unknown) =>
  new AIError(
    error instanceof OpenAI.APIError ? `The AI service returned ${error.status ?? "an error"}: ${error.message}` : "Could not reach the AI service",
    "provider",
  );

type JSONOptions<T> = {
  system: string;
  content: Content;
  schema: z.ZodType<T>;
  jsonSchema: Record<string, unknown>;
  name: string;
  effort?: ReasoningEffort;
  maxTokens?: number;
  /** Streams the model's reasoning as it thinks (the report page shows it live). */
  onReasoning?: (delta: string) => void;
};

/** One completion: streamed when onReasoning is set, so the reasoning can be shown live. */
async function complete(config: NebiusConfig, body: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming, onReasoning?: (d: string) => void) {
  const client = getClient(config);
  if (!onReasoning) {
    const r = await client.chat.completions.create(body);
    if (r.usage) config.onUsage?.(r.usage);
    return { content: r.choices[0]?.message?.content ?? "", finish: r.choices[0]?.finish_reason };
  }
  const stream = await client.chat.completions.create({ ...body, stream: true, stream_options: { include_usage: true } });
  let content = "";
  let finish: string | null | undefined;
  for await (const chunk of stream) {
    if (chunk.usage) config.onUsage?.(chunk.usage);
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    const delta = choice.delta as { content?: string | null; reasoning_content?: string | null; reasoning?: string | null };
    const r = delta.reasoning_content ?? delta.reasoning;
    if (r) onReasoning(r);
    if (delta.content) content += delta.content;
    if (choice.finish_reason) finish = choice.finish_reason;
  }
  return { content, finish };
}

/**
 * One structured call: strict JSON-schema output (falling back to JSON mode on a 400), validated with zod.
 * If the reply doesn't validate, one repair turn sends the zod issues back with the model's own answer.
 */
export async function chatJSON<T>(config: NebiusConfig, opts: JSONOptions<T>): Promise<T> {
  const messages: Message[] = [
    { role: "system", content: opts.system },
    { role: "user", content: opts.content },
  ];
  let mode: "json_schema" | "json_object" = "json_schema";
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt++) {
    let reply;
    try {
      reply = await complete(
        config,
        {
          model: config.model,
          max_tokens: opts.maxTokens ?? 8192,
          response_format:
            mode === "json_schema"
              ? { type: "json_schema", json_schema: { name: opts.name, schema: opts.jsonSchema, strict: true } }
              : { type: "json_object" },
          messages,
          ...sampling(opts.effort ?? "medium"),
        },
        attempt === 0 ? opts.onReasoning : undefined,
      );
    } catch (error) {
      // A 400 usually means this response_format is unsupported: retry in JSON mode.
      if (error instanceof OpenAI.APIError && error.status === 400 && mode === "json_schema") {
        mode = "json_object";
        messages[0] = { role: "system", content: `${opts.system}\n\nReply with one JSON object matching this schema:\n${JSON.stringify(opts.jsonSchema)}` };
        continue;
      }
      throw providerError(error);
    }
    if (reply.finish === "length") throw new AIError("The answer was cut off. Try a shorter recording.", "truncated");
    try {
      return opts.schema.parse(JSON.parse(cleanModelJson(reply.content)));
    } catch (error) {
      lastError = error;
      // Repair turn: show the model what was wrong with its own answer.
      messages.push(
        { role: "assistant", content: reply.content },
        { role: "user", content: `That JSON didn't match the schema: ${String((error as Error).message).slice(0, 1500)}\nReply again with the corrected JSON object only.` },
      );
    }
  }
  console.error(`AI call "${opts.name}" produced invalid output`, lastError);
  throw new AIError("The AI response couldn't be understood. Please try again.", "invalid_output");
}

export type ToolCallResult = {
  call?: { id: string; name: string; arguments: string };
  content: string;
  reasoning: string;
  usage: Usage;
};

/** One tool-calling turn. Returns the first tool call (if any), the text and the reasoning. */
export async function chatTools(
  config: NebiusConfig,
  opts: { messages: Message[]; tools: Tool[]; effort?: ReasoningEffort; maxTokens?: number },
): Promise<ToolCallResult> {
  try {
    const r = await getClient(config).chat.completions.create({
      model: config.model,
      max_tokens: opts.maxTokens ?? 4096,
      messages: opts.messages,
      tools: opts.tools,
      tool_choice: "auto",
      ...sampling(opts.effort ?? "low"),
    });
    if (r.usage) config.onUsage?.(r.usage);
    const message = r.choices[0]?.message;
    const call = message?.tool_calls?.find((c) => c.type === "function");
    return {
      call: call && "function" in call ? { id: call.id, name: call.function.name, arguments: call.function.arguments } : undefined,
      content: (message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim(),
      reasoning: reasoningOf(message),
      usage: { input: r.usage?.prompt_tokens ?? 0, output: r.usage?.completion_tokens ?? 0 },
    };
  } catch (error) {
    throw providerError(error);
  }
}
