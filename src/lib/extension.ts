"use client";

/**
 * Sends a message to the Repro extension. Its bridge content script runs on every page, so the app
 * talks to it with window.postMessage: this works on localhost and on any deployment, with no
 * per-domain build. Resolves null when the extension isn't installed or doesn't answer in time.
 */
export function sendToExtension<T = unknown>(message: Record<string, unknown>, timeoutMs = 4000): Promise<T | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  const id = crypto.randomUUID();
  return new Promise((resolve) => {
    const onReply = (e: MessageEvent) => {
      if (e.source !== window || e.data?.source !== "repro-ext" || e.data.id !== id) return;
      cleanup();
      resolve((e.data.response as T) ?? null);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener("message", onReply);
    };
    window.addEventListener("message", onReply);
    window.postMessage({ source: "repro-app", id, message }, window.location.origin);
  });
}
