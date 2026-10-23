// Isolated-world relay between the page capture and the background. It keeps the last 30 seconds of events
// locally and forwards them only while this tab is being recorded or reproduced.
import type { CapturedEvent } from "@shared/page-runtime";
import { defineContentScript } from "wxt/utils/define-content-script";

const KEEP_MS = 30_000;

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  main() {
    const recent: CapturedEvent[] = [];
    let forwarding = false;

    const send = (event: CapturedEvent) => chrome.runtime.sendMessage({ type: "repro:event", event }).catch(() => {});

    window.addEventListener("message", (e) => {
      // The Repro web app asking the extension something (pairing, reproduce): relay to the background,
      // which checks this page's origin, and post the answer back to the page.
      if (e.source === window && e.data?.source === "repro-app" && typeof e.data.id === "string") {
        const { id, message } = e.data as { id: string; message: unknown };
        chrome.runtime
          .sendMessage({ type: "repro:from-app", message })
          .then((response) => window.postMessage({ source: "repro-ext", id, response }, location.origin))
          .catch(() => {});
        return;
      }
      if (e.source !== window || e.data?.source !== "repro-page") return;
      const event = e.data.event as CapturedEvent;
      recent.push(event);
      const cutoff = Date.now() - KEEP_MS;
      while (recent.length && (recent[0].ts < cutoff || recent.length > 600)) recent.shift();
      if (forwarding) void send(event);
    });

    chrome.runtime.onMessage.addListener((msg: { type: string; on?: boolean }, _sender, reply) => {
      if (msg.type === "repro:forward") {
        forwarding = Boolean(msg.on);
        reply({ events: forwarding ? [...recent] : [] });
      } else if (msg.type === "repro:recent") {
        reply({ events: [...recent] });
      }
    });

    // After a navigation inside a recording, pick up where the previous page left off.
    chrome.runtime
      .sendMessage({ type: "repro:bridge-hello" })
      .then((r: { forward?: boolean } | undefined) => {
        if (!r?.forward) return;
        forwarding = true;
        recent.forEach((event) => void send(event));
      })
      .catch(() => {});
  },
});
