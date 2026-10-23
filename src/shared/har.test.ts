import { describe, expect, it } from "vitest";
import { toCurl, toHar } from "./har";
import type { NetworkEntry } from "./schemas";

const post: NetworkEntry = {
  t: 1.5,
  kind: "fetch",
  method: "POST",
  url: "https://shop.test/api/profile?x=1",
  status: 500,
  durationMs: 42.4,
  requestHeaders: { "content-type": "application/json", authorization: "[redacted]", "sec-fetch-mode": "cors" },
  responseHeaders: { "content-type": "application/json" },
  requestBody: `{"name":"O'Neil"}`,
  responseBody: '{"error":"boom"}',
};

describe("toHar", () => {
  it("writes a valid HAR 1.2 entry per request, timed from the recording start", () => {
    const har = toHar([post], { startedAt: new Date("2026-10-23T10:00:00.000Z"), pageUrl: "https://shop.test/profile" });
    expect(har.log.version).toBe("1.2");
    const e = har.log.entries[0];
    expect(e.startedDateTime).toBe("2026-10-23T10:00:01.500Z");
    expect(e.time).toBe(42);
    expect(e.request.queryString).toEqual([{ name: "x", value: "1" }]);
    expect(e.request.postData).toEqual({ mimeType: "application/json", text: `{"name":"O'Neil"}` });
    expect(e.response.status).toBe(500);
    expect(e.response.content.text).toBe('{"error":"boom"}');
  });
});

describe("toCurl", () => {
  it("builds a runnable command, quoting safely and skipping browser-only headers", () => {
    const cmd = toCurl(post);
    expect(cmd).toContain("curl 'https://shop.test/api/profile?x=1'");
    expect(cmd).toContain("-X POST");
    expect(cmd).toContain("-H 'authorization: [redacted]'");
    expect(cmd).not.toContain("sec-fetch-mode");
    expect(cmd).toContain(`--data-raw '{"name":"O'\\''Neil"}'`);
  });

  it("omits -X for a plain GET", () => {
    expect(toCurl({ ...post, method: "GET", requestBody: undefined })).not.toContain("-X");
  });
});
