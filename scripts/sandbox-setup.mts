// Gets the fix sandbox ready and says what it will use:
//   Docker running?  → pulls the node image once, so the first check doesn't spend its time downloading
//   a browser?       → the sandbox's agent needs Playwright's Chromium or an installed Chrome
//   pnpm sandbox:setup
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { launchBrowser } from "../src/server/browser/driver";
import { detectProvider, SANDBOX_IMAGE } from "../src/server/sandbox";

const provider = await detectProvider();
if (provider === "docker") {
  console.log(`Docker is running. Pulling ${SANDBOX_IMAGE}…`);
  execFileSync("docker", ["pull", SANDBOX_IMAGE], { stdio: "inherit" });
  const node = execFileSync("docker", ["run", "--rm", SANDBOX_IMAGE, "node", "-v"]).toString().trim();
  console.log(`✓ Sandbox: Docker (${SANDBOX_IMAGE}, Node ${node})`);
} else if (process.env.SANDBOX_PROVIDER === "process") {
  console.log("✓ Sandbox: local process (SANDBOX_PROVIDER=process). Fixes are checked on a throwaway copy, not isolated.");
} else {
  console.log("✗ Docker isn't running. Start Docker Desktop (https://www.docker.com/products/docker-desktop) and run this again,");
  console.log("  or set SANDBOX_PROVIDER=process to check fixes as a local process (not isolated).");
}

try {
  const browser = await launchBrowser();
  console.log(`✓ Browser for the sandbox agent: ${browser.browserType().name()} ${browser.version()}`);
  await browser.close();
} catch {
  console.log("✗ No browser for the sandbox agent. Install Chrome, or run: pnpm exec playwright-core install chromium");
  process.exitCode = 1;
}
if (provider !== "docker" && process.env.SANDBOX_PROVIDER !== "process") process.exitCode = 1;
