// What the store should do. Each seeded bug makes one of these fail.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { nextQuantity } from "../public/js/lib/cart.js";
import { applyCoupon } from "../public/js/lib/pricing.js";
import { isValidEmail } from "../public/js/lib/validate.js";
import { LOGIN, startServer } from "../server.mjs";

test("a 10% coupon takes 10% off the subtotal", () => {
  const { discount, total } = applyCoupon(144, { code: "SAVE10", valid: true, percent_off: 10 });
  assert.equal(discount, 14.4);
  assert.equal(total, 129.6);
});

test("+ adds one to the quantity", () => {
  assert.equal(nextQuantity(1), 2);
  assert.equal(nextQuantity(10), 10);
});

test("emails with + or subdomains are valid; obvious junk isn't", () => {
  assert.equal(isValidEmail("priya+alerts@example.com"), true);
  assert.equal(isValidEmail("ops@mail.example.co.uk"), true);
  assert.equal(isValidEmail("not-an-email"), false);
});

let app;
let cookie;
before(async () => {
  app = await startServer(0);
  const res = await fetch(`${app.url}/login`, { method: "POST", body: new URLSearchParams(LOGIN), redirect: "manual" });
  cookie = res.headers.get("set-cookie").split(";")[0];
});
after(() => app.close());

test("saving the profile stores the new display name", async () => {
  const res = await fetch(`${app.url}/api/profile`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ displayName: "Priya S." }) });
  assert.equal(res.status, 200);
  const saved = await (await fetch(`${app.url}/api/profile`, { headers: { cookie } })).json();
  assert.equal(saved.name, "Priya S.");
});

test("every link in the header opens a page", async () => {
  const html = await (await fetch(`${app.url}/checkout`, { headers: { cookie } })).text();
  const header = html.match(/<header>.*?<\/header>/s)[0];
  const links = header.matchAll(/href="([^"]+)"/g);
  for (const [, href] of links) {
    if (href === "/logout") continue;
    const res = await fetch(`${app.url}${href}`, { headers: { cookie }, redirect: "manual" });
    assert.equal(res.status, 200, `${href} returned ${res.status}`);
  }
});
