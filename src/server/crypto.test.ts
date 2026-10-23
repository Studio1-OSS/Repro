import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "./crypto";

describe("secret encryption", () => {
  it("round-trips, uses a fresh IV each time and rejects the wrong key or tampering", () => {
    const a = encrypt("ghp_secret", "k1");
    expect(a).not.toContain("ghp_secret");
    expect(encrypt("ghp_secret", "k1")).not.toBe(a);
    expect(decrypt(a, "k1")).toBe("ghp_secret");
    expect(() => decrypt(a, "k2")).toThrow();
    const parts = a.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decrypt(parts.join("."), "k1")).toThrow();
  });
});
