import { describe, expect, it } from "vitest";
import { redactHeaders, redactLogs, redactText } from "./redact";

describe("redactText", () => {
  it("replaces known secret formats with a typed placeholder", () => {
    expect(redactText("GET /api/coupons/SAVE10?key=sk_live_51Hxyz9ABCDEF")).toBe("GET /api/coupons/SAVE10?key=[redacted stripe-live-key]");
    expect(redactText("Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U")).toBe("Bearer [redacted jwt]");
    expect(redactText("aws AKIAIOSFODNN7EXAMPLE")).toBe("aws [redacted aws-access-key]");
    expect(redactText("token ghp_abcdefghijklmnopqrstuvwxyz0123456789")).toBe("token [redacted github-token]");
  });

  it("redacts secret-named parameters in query strings and JSON bodies", () => {
    expect(redactText("/login?user=priya&password=hunter22&next=/")).toBe("/login?user=priya&password=[redacted]&next=/");
    expect(redactText('{"email":"a@b.co","access_token":"abc123"}')).toBe('{"email":"a@b.co","access_token":"[redacted]"}');
    expect(redactText("/api/x?token=sk_live_51Hxyz9ABCDEF")).toBe("/api/x?token=[redacted stripe-live-key]");
  });

  it("leaves ordinary text alone and masks emails only when asked", () => {
    expect(redactText("Total shows $NaN after coupon")).toBe("Total shows $NaN after coupon");
    expect(redactText("signed in as priya@example.com")).toBe("signed in as priya@example.com");
    expect(redactText("signed in as priya@example.com", { emails: true })).toBe("signed in as p***@example.com");
  });
});

describe("redactHeaders", () => {
  it("blanks credential headers whatever their case", () => {
    expect(redactHeaders({ Authorization: "Bearer x", Cookie: "sid=1", "content-type": "application/json" })).toEqual({
      Authorization: "[redacted]",
      Cookie: "[redacted]",
      "content-type": "application/json",
    });
  });
});

describe("redactLogs", () => {
  it("covers console, network and actions", () => {
    const out = redactLogs({
      console: [{ t: 1, level: "log", text: "key sk_live_51Hxyz9ABCDEF" }],
      network: [
        {
          t: 1,
          kind: "fetch",
          method: "POST",
          url: "https://x.test/api?api_key=abc",
          status: 200,
          durationMs: 10,
          requestHeaders: { authorization: "Bearer y" },
          responseHeaders: {},
          requestBody: '{"password":"p"}',
        },
      ],
      actions: [{ t: 1, type: "input", target: 'input "Promo"', value: "sk_live_51Hxyz9ABCDEF" }],
    });
    expect(out.console[0].text).toBe("key [redacted stripe-live-key]");
    expect(out.network[0].url).toBe("https://x.test/api?api_key=[redacted]");
    expect(out.network[0].requestHeaders.authorization).toBe("[redacted]");
    expect(out.network[0].requestBody).toBe('{"password":"[redacted]"}');
    expect(out.actions[0].value).toBe("[redacted stripe-live-key]");
  });
});

describe("removedSecrets", () => {
  const entry = (url: string, requestBody?: string) => ({ t: 1.6, kind: "fetch" as const, method: "POST", url, status: 200, durationMs: 5, requestHeaders: { authorization: "Bearer x" }, responseHeaders: {}, requestBody });

  it("lists secrets found in URLs and known key formats anywhere, without their values", () => {
    const out = redactLogs({ console: [], actions: [], network: [entry("https://x.test/api/coupons/A?token=sk_live_51Hxyz9ABCDEF", '{"key":"sk_live_51Hxyz9ABCDEF"}')] });
    expect(out.removedSecrets).toEqual([
      { t: 1.6, kind: "stripe-live-key", where: "request URL of POST https://x.test/api/coupons/A" },
      { t: 1.6, kind: "stripe-live-key", where: "request body of POST https://x.test/api/coupons/A" },
    ]);
    expect(JSON.stringify(out)).not.toContain("51Hxyz9ABCDEF");
  });

  it("doesn't report credentials in their normal places: auth headers and sign-in bodies", () => {
    const out = redactLogs({ console: [], actions: [], network: [entry("https://x.test/login", "email=a%40b.co&password=hunter22")] });
    expect(out.removedSecrets).toEqual([]);
    expect(out.network[0].requestBody).toBe("email=a%40b.co&password=[redacted]");
  });
});
