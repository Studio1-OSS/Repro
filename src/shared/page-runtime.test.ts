// Runs the in-page runtime in a real browser (Playwright's Chromium or Chrome); skipped when none is installed.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromiumPath, launchBrowser, RUNTIME_SOURCE, type Browser } from "../../bench/driver";
import type { LayoutAudit, PageSnapshot } from "./page-runtime";

const hasBrowser = Boolean(chromiumPath()) || process.platform === "darwin";
const call = (fn: string, ...args: unknown[]) => `(function(){${RUNTIME_SOURCE};return ${fn}(${args.map((a) => JSON.stringify(a)).join(",")});})()`;

const FIXTURE = `<!doctype html><html><body style="margin:0;font:16px sans-serif">
<button id="plain">Save</button>
<div id="host"></div>
<iframe id="frame" style="position:absolute;top:100px;left:50px;width:300px;height:100px;border:0"></iframe>
<div style="width:520px;background:#eee" id="wide">A row that is far too wide for a phone</div>
<div style="width:120px;overflow:hidden;white-space:nowrap" id="clip">This label is much longer than its box</div>
<a href="#" style="display:inline-block;width:16px;height:16px" aria-label="Tiny">x</a>
<select id="stuck" onchange="this.value='az'"><option value="az">Name (A to Z)</option><option value="lohi">Price (low to high)</option></select>
<select id="sort" onchange="document.title='sorted:'+this.value"><option value="az">Name (A to Z)</option><option value="lohi">Price (low to high)</option></select>
<button style="position:absolute;top:300px;left:10px;width:100px;height:40px">Under</button>
<button style="position:absolute;top:310px;left:40px;width:100px;height:40px">Over</button>
<script>
  document.getElementById('host').attachShadow({mode:'open'}).innerHTML = '<button>Shadow action</button>';
  document.getElementById('frame').srcdoc = '<button style="margin:10px">Frame action</button>';
</script></body></html>`;

describe.skipIf(!hasBrowser)("page runtime in a browser", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await launchBrowser();
  }, 30_000);
  afterAll(async () => browser?.close());

  it("lists elements in shadow DOM and same-origin iframes, and clicks them at the right spot", async () => {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.setContent(FIXTURE);
    await page.waitForTimeout(200);
    const snap = (await page.evaluate(call("snapshotPage"))) as PageSnapshot;
    expect(snap.elements).toContain('button "Save"');
    const shadow = snap.elements.split("\n").find((l) => l.includes("Shadow action"))!;
    const frame = snap.elements.split("\n").find((l) => l.includes("Frame action"))!;
    expect(shadow).toContain("in-shadow-dom");
    expect(frame).toContain("in-iframe");
    const frameId = Number(frame.match(/^\[(\d+)\]/)![1]);
    const p = (await page.evaluate(call("elementCenter", frameId))) as { x: number; y: number };
    // The iframe starts at (50, 100); its button sits ~10px inside.
    expect(p.x).toBeGreaterThan(55);
    expect(p.y).toBeGreaterThan(105);
    const hit = await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return el?.tagName;
    }, [p.x, p.y]);
    expect(hit).toBe("IFRAME");
    await page.close();
  });

  it("lists dropdown options and picks one by its label, firing change", async () => {
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.setContent(FIXTURE);
    const snap = (await page.evaluate(call("snapshotPage"))) as PageSnapshot;
    const line = snap.elements.split("\n").find((l) => l.includes("#sort"))!;
    expect(line).toContain("Price (low to high)");
    const id = Number(line.match(/^\[(\d+)\]/)![1]);
    expect(await page.evaluate(call("selectOption", id, "price (low to high)"))).toBe("ok:Price (low to high)");
    expect(await page.title()).toBe("sorted:lohi");
    expect(await page.evaluate(call("selectOption", id, "Newest"))).toBe("no-option");
    // A page that puts the old value back (the bug, often) is reported, not hidden.
    const stuck = snap.elements.split("\n").find((l) => l.includes("#stuck"))!;
    const stuckId = Number(stuck.match(/^\[(\d+)\]/)![1]);
    expect(await page.evaluate(call("selectOption", stuckId, "Price (low to high)"))).toBe("reverted:Name (A to Z)");
    await page.close();
  });

  it("logs what a control shows after the page handled the change", async () => {
    const page = await browser.newPage();
    const events: { kind: string; data: { type?: string; value?: string } }[] = [];
    await page.exposeBinding("__reproSink", (_s, e) => void events.push(e));
    await page.setContent(FIXTURE);
    await page.evaluate(call("installCapture"));
    await page.selectOption("#stuck", "lohi");
    await page.selectOption("#sort", "lohi");
    await page.waitForTimeout(100);
    const inputs = events.filter((e) => e.kind === "action" && e.data.type === "input").map((e) => e.data.value);
    expect(inputs).toEqual(["Price (low to high) (the page changed it back to Name (A to Z))", "Price (low to high)"]);
    await page.close();
  });

  it("knows when a password field has focus", async () => {
    const page = await browser.newPage();
    await page.setContent('<input id="u"><input id="p" type="password">');
    await page.focus("#u");
    expect(await page.evaluate(call("focusedIsPassword"))).toBe(false);
    await page.focus("#p");
    expect(await page.evaluate(call("focusedIsPassword"))).toBe(true);
    await page.close();
  });

  it("finds overflow, clipped text, tiny tap targets and overlaps at phone width", async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
    await page.setContent(FIXTURE);
    const audit = (await page.evaluate(call("layoutAudit"))) as LayoutAudit;
    expect(audit.overflowX).toBeGreaterThan(100);
    const kinds = audit.issues.map((i) => `${i.kind} ${i.element}`);
    expect(kinds.some((k) => k.startsWith("past-viewport div#wide"))).toBe(true);
    expect(kinds.some((k) => k.startsWith("clipped-text div#clip"))).toBe(true);
    expect(kinds.some((k) => k.includes("small-tap-target") && k.includes("Tiny"))).toBe(true);
    expect(kinds.some((k) => k.startsWith("overlap") && k.includes("Under"))).toBe(true);
    await page.close();
  });
});
