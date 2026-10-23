// Media storage: Cloudinary when CLOUDINARY_URL is set, otherwise files on local disk (.uploads/).
// The extension uploads straight to Cloudinary with a signature from us, so videos never pass through
// the app server (Vercel caps request bodies at 4.5 MB). No SDK: a signature is one SHA-1.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { nanoid } from "nanoid";

export type CloudinaryConfig = { cloud: string; key: string; secret: string };

export function parseCloudinaryUrl(url: string | undefined): CloudinaryConfig | null {
  const m = url?.match(/^cloudinary:\/\/([^:]+):([^@]+)@([^/?#]+)/);
  return m ? { key: decodeURIComponent(m[1]), secret: decodeURIComponent(m[2]), cloud: m[3] } : null;
}

/** Cloudinary's upload signature: SHA-1 of the sorted params (key=value&…) followed by the API secret. */
export function signCloudinary(params: Record<string, string | number>, secret: string): string {
  const query = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return createHash("sha1").update(query + secret).digest("hex");
}

export type UploadTarget =
  | { kind: "cloudinary"; url: string; fields: Record<string, string> }
  | { kind: "local"; url: string };

const UPLOAD_ROOT = resolve(process.cwd(), ".uploads");
const FOLDER = "repro";

export function createStorage(cloudinaryUrl: string | undefined, appUrl: string) {
  const cloudinary = parseCloudinaryUrl(cloudinaryUrl);

  /** Where the client should send one file. Cloudinary's "auto" type accepts images and video. */
  function uploadTarget(): UploadTarget {
    if (!cloudinary) return { kind: "local", url: `${appUrl}/api/uploads/local` };
    const params = { folder: FOLDER, timestamp: Math.floor(Date.now() / 1000) };
    return {
      kind: "cloudinary",
      url: `https://api.cloudinary.com/v1_1/${cloudinary.cloud}/auto/upload`,
      fields: { api_key: cloudinary.key, folder: FOLDER, timestamp: String(params.timestamp), signature: signCloudinary(params, cloudinary.secret) },
    };
  }

  /** Server-side upload (agent screenshots). Returns the public URL. */
  async function put(bytes: Buffer, contentType: string): Promise<string> {
    if (cloudinary) {
      const target = uploadTarget() as Extract<UploadTarget, { kind: "cloudinary" }>;
      const form = new FormData();
      Object.entries(target.fields).forEach(([k, v]) => form.set(k, v));
      form.set("file", `data:${contentType};base64,${bytes.toString("base64")}`);
      const res = await fetch(target.url, { method: "POST", body: form });
      if (!res.ok) throw new Error(`Cloudinary upload failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
      return ((await res.json()) as { secure_url: string }).secure_url;
    }
    return saveLocal(bytes, contentType);
  }

  return { kind: cloudinary ? ("cloudinary" as const) : ("local" as const), uploadTarget, put };
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/webm": "webm",
  "video/mp4": "mp4",
  "application/json": "json",
  "text/html": "html",
};
export const LOCAL_TYPES = Object.fromEntries(Object.entries(EXT).map(([type, ext]) => [ext, type]));

/** Saves to .uploads/<yyyy-mm>/<id>.<ext> and returns the /media/… URL that serves it. */
export async function saveLocal(bytes: Buffer, contentType: string): Promise<string> {
  const ext = EXT[contentType];
  if (!ext) throw new Error(`Unsupported type ${contentType}`);
  const key = `${new Date().toISOString().slice(0, 7)}/${nanoid(16)}.${ext}`;
  const path = join(UPLOAD_ROOT, key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  return `/media/${key}`;
}

/** Reads a local upload by key, refusing anything outside .uploads/. */
export async function readLocal(key: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  if (!/^\d{4}-\d{2}\/[A-Za-z0-9_-]{16}\.(jpg|png|webp|webm|mp4|json|html)$/.test(key)) return null;
  const path = resolve(UPLOAD_ROOT, key);
  if (!path.startsWith(UPLOAD_ROOT)) return null;
  try {
    return { bytes: await readFile(path), contentType: LOCAL_TYPES[key.split(".").pop()!] };
  } catch {
    return null;
  }
}

/**
 * A URL the model can open. Cloudinary URLs are public; local /media/… files only exist on this machine,
 * so they're sent inline as data URLs.
 */
export async function urlForModel(url: string): Promise<string> {
  if (url.startsWith("data:") || /^https:\/\//.test(url)) return url;
  const key = url.replace(/^.*\/media\//, "");
  const file = await readLocal(key);
  if (!file) throw new Error(`Missing upload ${key}`);
  return `data:${file.contentType};base64,${file.bytes.toString("base64")}`;
}
