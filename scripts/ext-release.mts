// Builds the extension and publishes it two ways, so nobody has to build it to use it:
//   extension/release/repro-extension/   ready for chrome://extensions → Load unpacked (committed)
//   public/repro-extension.zip           the install page's Download button
//   pnpm ext:release
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const ext = `${root}extension`;
execFileSync("pnpm", ["--filter", "repro-extension", "zip"], { cwd: root, stdio: "inherit" });

const target = `${ext}/release/repro-extension`;
rmSync(target, { recursive: true, force: true });
cpSync(`${ext}/.output/chrome-mv3`, target, { recursive: true });

const zip = readdirSync(`${ext}/.output`).find((f) => /^repro-extension-.*-chrome\.zip$/.test(f));
if (!zip || !existsSync(`${ext}/.output/${zip}`)) throw new Error("wxt zip produced no zip");
cpSync(`${ext}/.output/${zip}`, `${root}public/repro-extension.zip`);
console.log(`\n✓ Load unpacked from extension/release/repro-extension\n✓ Download: public/repro-extension.zip (${zip})`);
