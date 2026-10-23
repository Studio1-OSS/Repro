// Talking to the Repro app: the pairing (app URL + token) and authenticated requests.

declare const __APP_URL__: string;
/** The app this build was made for (WXT_APP_URL at build time). Pairing can point elsewhere. */
export const DEFAULT_APP_URL = __APP_URL__;

export type Pairing = { appUrl: string; token: string; user?: { name: string; email: string } };

export async function getPairing(): Promise<Pairing | null> {
  const { pairing } = await chrome.storage.local.get("pairing");
  return (pairing as Pairing | undefined) ?? null;
}

export async function setPairing(pairing: Pairing | null) {
  if (pairing) await chrome.storage.local.set({ pairing });
  else await chrome.storage.local.remove("pairing");
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; json?: unknown; pairing?: Pairing } = {}): Promise<T> {
  const pairing = init.pairing ?? (await getPairing());
  if (!pairing) throw new ApiError(401, "Connect the extension to Repro first.");
  const res = await fetch(`${pairing.appUrl}${path}`, {
    method: init.method ?? (init.json ? "POST" : "GET"),
    headers: { authorization: `Bearer ${pairing.token}`, ...(init.json ? { "content-type": "application/json" } : {}) },
    body: init.json ? JSON.stringify(init.json) : undefined,
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(res.status, body.error ?? `Repro returned ${res.status}`);
  return body;
}

type UploadTarget = { kind: "cloudinary"; url: string; fields: Record<string, string> } | { kind: "local"; url: string };

/** Uploads one file to wherever the app stores media (Cloudinary, or the app's own disk). Returns its URL. */
export async function upload(blob: Blob, filename: string, pairing?: Pairing): Promise<string> {
  const p = pairing ?? (await getPairing());
  if (!p) throw new ApiError(401, "Not connected");
  const target = await api<UploadTarget>("/api/uploads/sign", { method: "POST", pairing: p });
  const form = new FormData();
  if (target.kind === "cloudinary") Object.entries(target.fields).forEach(([k, v]) => form.set(k, v));
  form.set("file", blob, filename);
  const res = await fetch(target.url, {
    method: "POST",
    body: form,
    headers: target.kind === "local" ? { authorization: `Bearer ${p.token}` } : undefined,
  });
  const body = (await res.json().catch(() => ({}))) as { secure_url?: string; url?: string; error?: { message?: string } | string };
  if (!res.ok) throw new ApiError(res.status, typeof body.error === "string" ? body.error : (body.error?.message ?? `Upload failed (${res.status})`));
  return target.kind === "cloudinary" ? body.secure_url! : body.url!;
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, data] = dataUrl.split(",");
  const type = head.match(/data:([^;]+)/)?.[1] ?? "application/octet-stream";
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type });
}
