// Redaction runs in the extension before anything leaves the browser, and again on the server.
// Secrets are replaced with a typed placeholder ("[redacted stripe-live-key]") so the model can still
// say *that* a secret leaked, and where, without ever seeing it.
import type { ActionEvent, ConsoleEntry, NetworkEntry, RemovedSecret, ReportLogs } from "./schemas";

const SECRET_HEADERS = new Set(["authorization", "proxy-authorization", "cookie", "set-cookie", "x-api-key", "x-auth-token", "x-csrf-token"]);

const PATTERNS: [RegExp, string][] = [
  [/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g, "jwt"],
  [/\b(?:sk|rk)_live_[A-Za-z0-9]{8,}/g, "stripe-live-key"],
  [/\b(?:sk|rk|pk)_test_[A-Za-z0-9]{8,}/g, "stripe-test-key"],
  [/\bpk_live_[A-Za-z0-9]{8,}/g, "stripe-publishable-key"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "aws-access-key"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "github-token"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, "slack-token"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, "google-api-key"],
  [/\bsk-[A-Za-z0-9_-]{20,}/g, "api-key"],
];

/** query/body params whose values are always secret */
const SECRET_PARAM = /([?&;\s"']|^)((?:access_|refresh_|id_)?token|api[_-]?key|apikey|secret|client_secret|password|passwd|pwd|session(?:id)?|auth)(=|":\s*"|':\s*')([^&\s"';]+)/gi;
const EMAIL = /\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;

export type RedactOptions = { emails?: boolean };

/** Replaces secrets with placeholders. `found` collects what was removed (labels), for the report. */
export function redactText(input: string, opts: RedactOptions = {}, found?: string[]): string {
  let out = input;
  for (const [re, label] of PATTERNS) {
    out = out.replace(re, () => {
      found?.push(label);
      return `[redacted ${label}]`;
    });
  }
  out = out.replace(SECRET_PARAM, (_m, pre: string, key: string, sep: string, value: string) => {
    if (value.startsWith("[redacted")) return `${pre}${key}${sep}${value}`;
    found?.push(`${key.toLowerCase()} value`);
    return `${pre}${key}${sep}[redacted]`;
  });
  if (opts.emails) out = out.replace(EMAIL, "$1***@$2");
  return out;
}

/** Credential headers are expected (not a leak), so they're blanked without being reported. */
export function redactHeaders(headers: Record<string, string>, opts?: RedactOptions, found?: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SECRET_HEADERS.has(k.toLowerCase()) ? "[redacted]" : redactText(v, opts, found);
  }
  return out;
}

const cap = (s: string | undefined, n: number) => (s && s.length > n ? `${s.slice(0, n - 12)}…[truncated]` : s);

export function redactNetwork(e: NetworkEntry, opts?: RedactOptions, removed?: RemovedSecret[]): NetworkEntry {
  const where = `${e.method} ${e.url.split("?")[0]}`;
  // Generic "password=…"/"token=…" values are normal in a request body (that's how sign-in works);
  // known key formats are reported anywhere, since a key sent from the browser is exposed by definition.
  const track = (place: string, onlyKeyFormats = false) => {
    const found: string[] = [];
    const flush = () => found.filter((kind) => !onlyKeyFormats || !kind.endsWith(" value")).forEach((kind) => removed?.push({ t: e.t, kind, where: `${place} of ${where}` }));
    return { found, flush };
  };
  const url = track("request URL");
  const reqH = track("request headers");
  const resH = track("response headers");
  const reqB = track("request body", true);
  const resB = track("response body");
  const out: NetworkEntry = {
    ...e,
    url: redactText(e.url, opts, url.found),
    requestHeaders: redactHeaders(e.requestHeaders, opts, reqH.found),
    responseHeaders: redactHeaders(e.responseHeaders, opts, resH.found),
    requestBody: e.requestBody === undefined ? undefined : cap(redactText(e.requestBody, opts, reqB.found), 10_000),
    responseBody: e.responseBody === undefined ? undefined : cap(redactText(e.responseBody, opts, resB.found), 10_000),
    error: e.error && redactText(e.error, opts),
  };
  [url, reqH, resH, reqB, resB].forEach((x) => x.flush());
  return out;
}

/**
 * Redacts every log line. Secrets found outside the expected places (credential headers) are listed in
 * `removedSecrets`, so the analysis can report the leak without ever seeing the value.
 */
export function redactLogs(logs: ReportLogs, opts?: RedactOptions): ReportLogs {
  const removed: RemovedSecret[] = [...(logs.removedSecrets ?? [])];
  const inText = (t: number, place: string, text: string) => {
    const found: string[] = [];
    const out = redactText(text, opts, found);
    found.forEach((kind) => removed.push({ t, kind, where: place }));
    return out;
  };
  const result: ReportLogs = {
    console: logs.console.map((c): ConsoleEntry => ({ ...c, text: inText(c.t, `console ${c.level}`, c.text), stack: c.stack && redactText(c.stack, opts) })),
    network: logs.network.map((n) => redactNetwork(n, opts, removed)),
    actions: logs.actions.map((a): ActionEvent => ({ ...a, value: a.value && inText(a.t, `typed into ${a.target ?? "a field"}`, a.value), url: a.url && inText(a.t, "page URL", a.url) })),
  };
  // Same secret in the same place is reported once.
  const seen = new Set<string>();
  result.removedSecrets = removed.filter((r) => !seen.has(`${r.kind}|${r.where}`) && Boolean(seen.add(`${r.kind}|${r.where}`))).slice(0, 50);
  return result;
}
