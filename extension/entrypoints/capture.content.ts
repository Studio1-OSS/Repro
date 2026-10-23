// Runs in the page's own JavaScript world from the first moment, so it sees every console call and request.
// Events go to the bridge (bridge.content.ts) with window.postMessage; nothing leaves the tab from here.
import { installCapture } from "@shared/page-runtime.js";
import { defineContentScript } from "wxt/utils/define-content-script";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  world: "MAIN",
  main() {
    installCapture();
  },
});
