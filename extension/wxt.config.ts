import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { defineConfig } from "wxt";

// Where "Connect to Repro" points before the extension is paired. Pairing from any Repro app works
// regardless (it goes through the bridge content script), so one build serves every deployment.
const appUrl = (process.env.WXT_APP_URL || "http://localhost:3000").replace(/\/$/, "");

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
    plugins: [tailwindcss()],
    resolve: { alias: { "@shared": fileURLToPath(new URL("../src/shared", import.meta.url)) } },
    define: { __APP_URL__: JSON.stringify(appUrl) },
  }),
  manifest: {
    name: "Repro: record and reproduce bugs",
    short_name: "Repro",
    description: "Record a bug with its console, network and clicks. AI writes the report and reproduces it in your browser.",
    permissions: ["tabCapture", "offscreen", "debugger", "activeTab", "scripting", "storage", "tabs"],
    host_permissions: ["<all_urls>"],
    action: { default_title: "Repro" },
  },
});
