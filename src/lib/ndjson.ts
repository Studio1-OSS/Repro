"use client";

/** Reads a newline-delimited JSON stream, calling `onLine` for each message. Non-2xx responses throw. */
export async function readNdjson(res: Response, onLine: (msg: Record<string, unknown> & { type: string }) => void) {
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines.filter(Boolean)) onLine(JSON.parse(line));
  }
  if (buffer.trim()) onLine(JSON.parse(buffer));
}
