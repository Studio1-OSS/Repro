// The fix agent: reads the app's source (all of it when it fits, through tools when it doesn't) and
// proposes search/replace edits for the bug in a report. No server-only imports: the bench runs this code.
import { createTwoFilesPatch } from "diff";
import { z } from "zod";
import type { Analysis } from "@/shared/schemas";
import type { Source } from "../source";
import { chatTools, type Message, type NebiusConfig, type Tool, type Usage } from "./nebius";

export type Edit = { path: string; search: string; replace: string };
export type FixProposal = { explanation: string; edits: Edit[]; testHint: string; diff: string; filesRead: string[]; wholeRepo: boolean; usage: Usage };

export type FixContext = {
  title: string;
  pageUrl: string;
  note?: string | null;
  analysis: Analysis;
  /** Compact log text (formatLogs) around the bug. */
  logs: string;
  /** What the reproduce agent saw, if it ran. */
  reproduced?: string;
  /** A previous attempt that didn't fix it, with what still happened. */
  previous?: { edits: Edit[]; failure: string };
  /** Storage keys, cookie names and performance at capture time (formatPageState). */
  pageState?: string;
};

/**
 * Repos up to this many characters go into the prompt whole (about 50k tokens). Bigger ones are read
 * through the tools: the context could take far more, but resending it on every turn is slow and costly.
 */
const WHOLE_REPO_CHARS = 200_000;
const MAX_TURNS = 20;

const editSchema = z.object({ path: z.string().min(1), search: z.string(), replace: z.string() });
const proposalSchema = z.object({ explanation: z.string().min(1), edits: z.array(editSchema).min(1).max(20), test_hint: z.string().default("") });

const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[]): Tool => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } },
});

const TOOLS: Tool[] = [
  tool("read_file", "Read a file from the repository.", { path: { type: "string" } }, ["path"]),
  tool("search", "Find lines containing text (case-insensitive) across the repository. Returns path:line: text.", { query: { type: "string" } }, ["query"]),
  tool(
    "propose_fix",
    "Finish with the fix. Each edit replaces one exact, unique snippet of a file (copy `search` character for character from the file, with enough lines to be unique). To create a new file, use an empty `search`.",
    {
      explanation: { type: "string", description: "What was wrong and why this change fixes it, in two or three sentences" },
      edits: {
        type: "array",
        items: { type: "object", properties: { path: { type: "string" }, search: { type: "string" }, replace: { type: "string" } }, required: ["path", "search", "replace"], additionalProperties: false },
      },
      test_hint: { type: "string", description: "How to check the fix by hand, in one sentence" },
    },
    ["explanation", "edits", "test_hint"],
  ),
];

export const FIX_SYSTEM_PROMPT = `You fix bugs in web apps. You get a bug report (written from a screen recording and the browser's console and network logs), evidence that the bug reproduces, and the app's source code.

Find the root cause in the source and fix it with the smallest change that makes the reported behaviour correct:
- Fix the cause, not the symptom (e.g. read the field the API really returns rather than hiding NaN).
- Keep the code style. Don't refactor, rename or reformat unrelated code. Don't edit tests to make them pass.
- If a server bug and a client bug both contribute, fix the server cause and make the client handle errors honestly.
- Look for code paths that only some users, roles, flags or environments take (e.g. "if (isSomeUser()) return"): bugs that only one person sees often live there.
- Use read_file and search only for code you haven't seen; when the whole repository is already above, read it there. When you're sure, call propose_fix once.`;

/** Applies search/replace edits to file contents. Each search must match exactly once (empty = new file). */
export function applyEdits(files: Map<string, string>, edits: Edit[]): { files: Map<string, string>; errors: string[] } {
  const out = new Map(files);
  const errors: string[] = [];
  for (const e of edits) {
    const current = out.get(e.path);
    if (e.search === "") {
      if (current !== undefined) errors.push(`${e.path}: file exists; give a search snippet to replace`);
      else out.set(e.path, e.replace);
      continue;
    }
    if (current === undefined) {
      errors.push(`${e.path}: no such file`);
      continue;
    }
    const first = current.indexOf(e.search);
    if (first < 0) errors.push(`${e.path}: search text not found (copy it exactly from the file)`);
    else if (current.indexOf(e.search, first + 1) >= 0) errors.push(`${e.path}: search text appears more than once; include more lines`);
    else out.set(e.path, current.slice(0, first) + e.replace + current.slice(first + e.search.length));
  }
  return { files: out, errors };
}

/** A unified diff of every changed file. */
export function renderDiff(before: Map<string, string>, after: Map<string, string>): string {
  const paths = [...new Set([...before.keys(), ...after.keys()])].filter((p) => before.get(p) !== after.get(p)).sort();
  return paths.map((p) => createTwoFilesPatch(`a/${p}`, `b/${p}`, before.get(p) ?? "", after.get(p) ?? "", "", "", { context: 3 })).join("\n");
}

function contextMessage(ctx: FixContext): string {
  const a = ctx.analysis;
  return [
    `Bug report: ${a.title}`,
    ctx.note ? `Reporter's note: "${ctx.note}"` : "",
    `Page: ${ctx.pageUrl}`,
    `Summary: ${a.summary}`,
    "Steps:",
    ...a.steps.map((s, i) => `${i + 1}. ${s.action}`),
    `Expected: ${a.expected}`,
    `Actual: ${a.actual}`,
    `Likely cause (from the logs): ${a.suspectedCause}`,
    ...(a.evidence.length ? ["Evidence:", ...a.evidence.map((e) => `- ${e}`)] : []),
    ...(a.layout.length ? ["Layout problems:", ...a.layout.map((l) => `- ${l.width}px ${l.element}: ${l.issue} (suggested: ${l.suggestion})`)] : []),
    ctx.reproduced ? `Reproduced in a browser: ${ctx.reproduced}` : "",
    ctx.pageState ? `\n${ctx.pageState}` : "",
    "",
    "Captured logs:",
    ctx.logs.slice(0, 20_000),
    ...(ctx.previous
      ? ["", "A previous fix did NOT work:", JSON.stringify(ctx.previous.edits, null, 1).slice(0, 6000), `What still happened: ${ctx.previous.failure}`, "Try a different change."]
      : []),
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export async function proposeFix(config: NebiusConfig, source: Source, ctx: FixContext, opts: { onProgress?: (text: string) => void } = {}): Promise<FixProposal> {
  const progress = opts.onProgress ?? (() => {});
  const files = await source.list();
  const total = files.reduce((n, f) => n + f.size, 0);
  const wholeRepo = total <= WHOLE_REPO_CHARS;
  const contents = new Map<string, string>();
  const read = async (path: string) => {
    if (!contents.has(path)) contents.set(path, await source.read(path));
    return contents.get(path)!;
  };

  let repoText: string;
  if (wholeRepo) {
    progress(`Reading all ${files.length} source files (${Math.round(total / 1000)} kB) into the model's context`);
    for (const f of files) await read(f.path);
    repoText = files.map((f) => `=== ${f.path} ===\n${contents.get(f.path)}`).join("\n\n");
  } else {
    progress(`Repository has ${files.length} source files; the model will read what it needs`);
    repoText = `Files (${files.length}):\n${files.map((f) => f.path).join("\n").slice(0, 60_000)}`;
  }

  const messages: Message[] = [
    { role: "system", content: FIX_SYSTEM_PROMPT },
    { role: "user", content: `${contextMessage(ctx)}\n\nREPOSITORY (${source.label})\n${repoText}` },
  ];
  const usage: Usage = { input: 0, output: 0 };
  const filesRead = new Set<string>(wholeRepo ? files.map((f) => f.path) : []);

  const seen = new Set<string>();
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    // Near the limit, ask for the best fix so far rather than more reading.
    if (turn === MAX_TURNS - 3) messages.push({ role: "user", content: "You're almost out of steps. Call propose_fix now with your best fix." });
    const r = await chatTools(config, { messages, tools: TOOLS, effort: "high", maxTokens: 16_000 });
    usage.input += r.usage.input;
    usage.output += r.usage.output;
    if (!r.call) {
      messages.push({ role: "assistant", content: r.content || "(no tool call)" }, { role: "user", content: "Use a tool: read_file, search, or propose_fix." });
      continue;
    }
    messages.push({ role: "assistant", content: "", tool_calls: [{ id: r.call.id, type: "function", function: { name: r.call.name, arguments: r.call.arguments } }] });
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(r.call.arguments || "{}");
    } catch {}
    let result: string;
    const key = `${r.call.name}:${r.call.arguments}`;

    if (r.call.name !== "propose_fix" && seen.has(key)) {
      result = "You already ran exactly this; the result is the same as before. Use what you have: read a different file, or call propose_fix.";
    } else if (r.call.name === "read_file") {
      const path = String(args.path ?? "");
      if (!files.some((f) => f.path === path)) result = `No such file: ${path}`;
      else {
        progress(`Reading ${path}`);
        filesRead.add(path);
        result = (await read(path)).slice(0, 120_000);
      }
    } else if (r.call.name === "search") {
      const q = String(args.query ?? "").toLowerCase();
      progress(`Searching for "${q}"`);
      const hits: string[] = [];
      for (const f of files) {
        if (hits.length >= 40 || !q) break;
        (await read(f.path)).split("\n").forEach((line, i) => {
          if (hits.length < 40 && line.toLowerCase().includes(q)) hits.push(`${f.path}:${i + 1}: ${line.trim().slice(0, 200)}`);
        });
      }
      result = hits.length ? hits.join("\n") : "No matches.";
    } else if (r.call.name === "propose_fix") {
      const parsed = proposalSchema.safeParse(args);
      if (!parsed.success) result = `Invalid proposal: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`;
      else {
        for (const e of parsed.data.edits) if (files.some((f) => f.path === e.path)) await read(e.path);
        const applied = applyEdits(contents, parsed.data.edits);
        if (applied.errors.length) result = `These edits can't be applied:\n${applied.errors.join("\n")}\nFix them and call propose_fix again.`;
        else {
          const before = new Map(parsed.data.edits.map((e) => [e.path, contents.get(e.path) ?? ""]));
          const after = new Map(parsed.data.edits.map((e) => [e.path, applied.files.get(e.path)!]));
          return { explanation: parsed.data.explanation, edits: parsed.data.edits, testHint: parsed.data.test_hint, diff: renderDiff(before, after), filesRead: [...filesRead], wholeRepo, usage };
        }
      }
    } else result = `Unknown tool ${r.call.name}.`;
    seen.add(key);
    messages.push({ role: "tool", tool_call_id: r.call.id, content: result });
  }
  throw new Error("The model didn't propose a fix within the step limit.");
}
