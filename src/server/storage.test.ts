import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createStorage, parseCloudinaryUrl, readLocal, signCloudinary } from "./storage";

describe("storage", () => {
  it("parses CLOUDINARY_URL", () => {
    expect(parseCloudinaryUrl("cloudinary://123456:abc-DEF@my-cloud")).toEqual({ key: "123456", secret: "abc-DEF", cloud: "my-cloud" });
    expect(parseCloudinaryUrl(undefined)).toBeNull();
    expect(parseCloudinaryUrl("https://example.com")).toBeNull();
  });

  it("signs uploads the way Cloudinary documents (sorted params + secret, SHA-1)", () => {
    const expected = createHash("sha1").update("folder=repro&timestamp=1315060510abcd").digest("hex");
    expect(signCloudinary({ timestamp: 1315060510, folder: "repro" }, "abcd")).toBe(expected);
  });

  it("hands out a signed Cloudinary target, or the local endpoint without one", () => {
    const cloud = createStorage("cloudinary://k:s@c", "http://localhost:3000").uploadTarget();
    expect(cloud.kind).toBe("cloudinary");
    expect(cloud.url).toBe("https://api.cloudinary.com/v1_1/c/auto/upload");
    if (cloud.kind === "cloudinary") expect(Object.keys(cloud.fields).sort()).toEqual(["api_key", "folder", "signature", "timestamp"]);
    expect(createStorage(undefined, "http://localhost:3000").uploadTarget()).toEqual({ kind: "local", url: "http://localhost:3000/api/uploads/local" });
  });

  it("refuses local keys that could escape the uploads folder", async () => {
    expect(await readLocal("../.env")).toBeNull();
    expect(await readLocal("2026-10/../../x.jpg")).toBeNull();
    expect(await readLocal("2026-10/AAAAAAAAAAAAAAAA.exe")).toBeNull();
  });
});
