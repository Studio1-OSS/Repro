// HAR 1.2 export and "Copy as cURL" for captured requests. Logs are already redacted, so neither leaks
// secrets. Drop the .har into Chrome DevTools → Network to inspect a report in the real DevTools.
import type { NetworkEntry } from "./schemas";

const headerList = (h: Record<string, string>) => Object.entries(h).map(([name, value]) => ({ name, value }));

function queryString(url: string) {
  try {
    return [...new URL(url).searchParams].map(([name, value]) => ({ name, value }));
  } catch {
    return [];
  }
}

const contentType = (h: Record<string, string>) => Object.entries(h).find(([k]) => k.toLowerCase() === "content-type")?.[1] ?? "";

export function toHar(network: NetworkEntry[], opts: { startedAt: Date; pageUrl: string; pageTitle?: string; creator?: string }) {
  const pageId = "page_1";
  const at = (t: number) => new Date(opts.startedAt.getTime() + t * 1000).toISOString();
  return {
    log: {
      version: "1.2",
      creator: { name: opts.creator ?? "Repro", version: "0.1.0" },
      pages: [{ startedDateTime: at(0), id: pageId, title: opts.pageTitle || opts.pageUrl, pageTimings: {} }],
      entries: network.map((n) => {
        const reqType = contentType(n.requestHeaders) || "text/plain";
        const resType = contentType(n.responseHeaders) || "application/octet-stream";
        return {
          pageref: pageId,
          startedDateTime: at(n.t),
          time: Math.round(n.durationMs),
          request: {
            method: n.method,
            url: n.url,
            httpVersion: "HTTP/1.1",
            headers: headerList(n.requestHeaders),
            queryString: queryString(n.url),
            cookies: [],
            headersSize: -1,
            bodySize: n.requestBody?.length ?? 0,
            ...(n.requestBody !== undefined ? { postData: { mimeType: reqType, text: n.requestBody } } : {}),
          },
          response: {
            status: n.status,
            statusText: n.error ?? "",
            httpVersion: "HTTP/1.1",
            headers: headerList(n.responseHeaders),
            cookies: [],
            content: { size: n.responseBody?.length ?? 0, mimeType: resType, ...(n.responseBody !== undefined ? { text: n.responseBody } : {}) },
            redirectURL: "",
            headersSize: -1,
            bodySize: n.responseBody?.length ?? -1,
          },
          cache: {},
          timings: { send: 0, wait: Math.round(n.durationMs), receive: 0 },
          _resourceType: n.kind,
        };
      }),
    },
  };
}

/** Single-quote for a POSIX shell. */
const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Headers the browser sets itself; leaving them out keeps the command readable and portable. */
const SKIP = /^(host|connection|content-length|accept-encoding|sec-|:)/i;

export function toCurl(n: NetworkEntry): string {
  const parts = [`curl ${sh(n.url)}`];
  if (n.method !== "GET" || n.requestBody) parts.push(`-X ${n.method}`);
  for (const [k, v] of Object.entries(n.requestHeaders)) if (!SKIP.test(k)) parts.push(`-H ${sh(`${k}: ${v}`)}`);
  if (n.requestBody) parts.push(`--data-raw ${sh(n.requestBody)}`);
  return parts.join(" \\\n  ");
}
