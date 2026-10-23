// Checks what a model on Nebius Token Factory supports before you point Repro at it: image input,
// timestamped frames, video input, strict JSON, tool calls, reasoning and streaming.
//
//   pnpm smoke:nebius                       # NEBIUS_MODEL from .env
//   pnpm smoke:nebius --model <model-id>
import "dotenv/config";
import OpenAI from "openai";
import { reasoningOf } from "../src/server/ai/nebius.ts";
import { LOGIN as DEMO_LOGIN, startServer as startDemoServer } from "../bench/app/server.mjs";
import { launchBrowser, shot, VIEWPORT } from "../bench/driver.ts";

const args = process.argv.slice(2);
const modelFlag = args.indexOf("--model");
const model = modelFlag >= 0 ? args[modelFlag + 1] : process.env.NEBIUS_MODEL || "MiniMaxAI/MiniMax-M3.1-Flash";
const apiKey = process.env.NEBIUS_API_KEY;
if (!apiKey) {
  console.error("✗ NEBIUS_API_KEY is not set. Add it to .env first.");
  process.exit(1);
}
const baseURL = process.env.NEBIUS_BASE_URL || "https://api.tokenfactory.us-north1.nebius.com/v1/";
const client = new OpenAI({ apiKey, baseURL, timeout: 180_000 });
console.log(`Model ${model} at ${baseURL}\n`);

// Two screenshots of the benchmark app: before and after the coupon bug.
const server = await startDemoServer(Number(process.env.DEMO_PORT || 4402));
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: VIEWPORT });
await page.goto(`${server.url}/login?next=/checkout`);
await page.fill("#p", DEMO_LOGIN.password);
await Promise.all([page.waitForURL(`${server.url}/checkout`), page.click("button")]);
const before = await shot(page);
await page.fill("#coupon", "SAVE10");
await page.click("#apply");
await page.waitForTimeout(500);
const after = await shot(page);
await browser.close();
server.close();

type Part = OpenAI.Chat.Completions.ChatCompletionContentPart;
const ask = (content: Part[], extra: Record<string, unknown> = {}) =>
  client.chat.completions.create({ model, max_tokens: 2000, messages: [{ role: "user", content }], ...extra } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);

const results: [string, boolean, string][] = [];
async function check(name: string, fn: () => Promise<[boolean, string]>) {
  const t = Date.now();
  try {
    const [ok, note] = await fn();
    results.push([name, ok, `${note} (${Date.now() - t}ms)`]);
  } catch (e) {
    results.push([name, false, e instanceof OpenAI.APIError ? `${e.status}: ${e.message.replace(/\s+/g, " ").slice(0, 110)}` : String(e).slice(0, 110)]);
  }
}

await check("Model listed", async () => {
  const ids = (await client.models.list()).data.map((m) => m.id);
  return [ids.includes(model), ids.includes(model) ? "found in /models" : "not in /models"];
});

await check("Image input", async () => {
  const r = await ask([{ type: "text", text: "What total does this checkout page show? Value only." }, { type: "image_url", image_url: { url: before } }]);
  const text = r.choices[0]?.message?.content?.trim() ?? "";
  return [/144/.test(text), `"${text.slice(0, 30)}", ${r.usage?.prompt_tokens} prompt tokens`];
});

await check("Timestamped frames (recordings)", async () => {
  const frames = Array.from({ length: 16 }, (_, i) => (i < 11 ? before : after));
  const r = await ask([
    { type: "text", text: "16 frames of a screen recording, 0.5s apart. When does the Total first change, and to what? Answer like '3.5s → $X'." },
    ...frames.flatMap((url, i): Part[] => [{ type: "text", text: `t=${(i * 0.5).toFixed(1)}s` }, { type: "image_url", image_url: { url, detail: "low" } }]),
  ]);
  const text = r.choices[0]?.message?.content?.trim() ?? "";
  return [/5\.5/.test(text) && /NaN/.test(text), `"${text.slice(0, 40)}", ${r.usage?.prompt_tokens} prompt tokens`];
});

await check("Video input (video_url)", async () => {
  const r = await ask([{ type: "text", text: "Describe this video in 10 words." }, { type: "video_url", video_url: { url: "https://res.cloudinary.com/demo/video/upload/dog.mp4" } } as unknown as Part]);
  return [Boolean(r.choices[0]?.message?.content), "supported: you can set AI_VIDEO_INPUT=1"];
});

await check("Strict JSON schema", async () => {
  const schema = { type: "object", properties: { total: { type: "string" } }, required: ["total"], additionalProperties: false };
  const r = await ask([{ type: "text", text: "Return the total shown, as JSON." }, { type: "image_url", image_url: { url: after } }], {
    response_format: { type: "json_schema", json_schema: { name: "t", schema, strict: true } },
  });
  const parsed = JSON.parse(r.choices[0]?.message?.content ?? "{}");
  return [typeof parsed.total === "string", `total ${parsed.total}`];
});

await check("Native tool calls", async () => {
  const r = await ask([{ type: "text", text: 'Elements:\n[6] input "Coupon"\n[7] button "Apply coupon"\nClick Apply coupon with the tool.' }], {
    tools: [{ type: "function", function: { name: "click", description: "Click element [id]", parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] } } }],
    tool_choice: "auto",
  });
  const call = r.choices[0]?.message?.tool_calls?.[0];
  const args = call && "function" in call ? call.function.arguments : "";
  return [/7/.test(args), call ? `click(${args})` : "no tool call (the agent falls back to JSON actions)"];
});

await check("Reasoning (reasoning_effort)", async () => {
  const r = await ask([{ type: "text", text: "Is 391 prime? One word." }], { reasoning_effort: "low" });
  const m = r.choices[0]?.message as unknown as Record<string, unknown>;
  const field = m.reasoning_content ? "reasoning_content" : m.reasoning ? "reasoning" : /<think>/.test(String(m.content)) ? "<think> in content" : "none";
  return [Boolean(r.choices[0]?.message?.content), `answer "${String(m.content).trim()}", reasoning in ${field} (${reasoningOf(m).length} chars)`];
});

await check("Streaming", async () => {
  const stream = await client.chat.completions.create({ model, max_tokens: 500, stream: true, reasoning_effort: "low", messages: [{ role: "user", content: "Count 1 to 5." }] } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming);
  let reasoning = 0;
  let content = "";
  for await (const chunk of stream) {
    const d = (chunk.choices?.[0]?.delta ?? {}) as Record<string, string | undefined>;
    reasoning += (d.reasoning_content ?? d.reasoning ?? "").length;
    content += d.content ?? "";
  }
  return [content.length > 0, `${reasoning} reasoning chars streamed, then "${content.replace(/\s+/g, " ").trim()}"`];
});

const width = Math.max(...results.map(([n]) => n.length));
for (const [name, ok, note] of results) console.log(`${ok ? "✓" : "✗"} ${name.padEnd(width)}  ${note}`);
const failed = results.filter(([n, ok]) => !ok && n !== "Video input (video_url)");
console.log(
  failed.length
    ? `\n${failed.length} check(s) failed. Repro needs image input, frames and JSON; tool calls have a JSON fallback.`
    : "\nAll required capabilities work. Recordings are sent as timestamped frames" + (results.find(([n]) => n.startsWith("Video"))?.[1] ? " (video input works too: AI_VIDEO_INPUT=1)." : "."),
);
