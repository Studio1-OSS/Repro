# Repro bench: MiniMaxAI/MiniMax-M3.1-Flash

2026-10-23 · 5 seeded bugs, 1 layout bug and 1 control in the bench fixture (`bench/app`), run with `pnpm bench --fix`.

| Case | Report complete | Cause found | Planted security issue flagged | Reproduced by agent | Fix verified in sandbox |
| --- | --- | --- | --- | --- | --- |
| coupon-nan | ✓ | ✓ | ✓ | ✓ (4 steps) | ✓ public/js/lib/pricing.js, public/js/checkout.js |
| profile-silent-500 | ✓ | ✓ | – | ✓ (4 steps) | ✓ server.mjs, public/js/profile.js |
| orders-dead-link | ✓ | ✓ | – | ✓ (2 steps) | ✓ server.mjs |
| email-plus-rejected | ✓ | ✓ | – | ✓ (3 steps) | ✓ public/js/lib/validate.js, public/js/settings.js, server.mjs |
| cart-plus-two | ✓ | ✓ | – | ✓ (2 steps) | ✓ public/js/lib/cart.js |
| checkout-overflow-mobile | ✓ | ✓ | – | – (measured) | ✓ public/styles.css |
| control-sign-out | control | – | – | ✓ said not reproduced | – |

- Reports: 6/6 complete, the real cause named in 6/6, planted security issue flagged 1/1.
- Agent: reproduced 5/5 bugs (its claim and the page state both checked); the control answered correctly 1/1.
- Fixes: 6/6 verified in the sandbox (the bug's failing test passes on the patched copy, and the agent can no longer reproduce it; the layout bug is measured instead).
- Average fix: 37.4s including the sandbox check, 26,034 input / 2,677 output tokens.
- Average report: 12.2s, 4,660 input / 742 output tokens.
- Average reproduce run: 3.0 steps, 6.7s, 12,822 input / 248 output tokens.

## Fixes

### coupon-nan

The coupon API returns the percentage in `percent_off`, but `applyCoupon` read `coupon.discount.rate`, which is undefined, so the multiplication produced NaN. The pricing helper now reads/validates `percent_off`, and the checkout handler rejects invalid responses instead of logging a synthetic TypeError, so the discount and total are computed from the real API field.

```diff
===================================================================
--- a/public/js/checkout.js
+++ b/public/js/checkout.js
@@ -9,7 +9,10 @@
   const res = await fetch(`/api/coupons/${encodeURIComponent(code)}?token=sk_live_51HbenchA7xQ2pLm9`, { headers: { "x-client": "web" } });
   const coupon = await res.json();
   console.log("coupon response", coupon);
-  if (!coupon.discount) console.error(new TypeError("Cannot read properties of undefined (reading 'rate')"));
+  if (!coupon.valid || !Number.isFinite(Number(coupon.percent_off))) {
+    $("msg").textContent = "Invalid coupon code.";
+    return;
+  }
   const { discount, total } = applyCoupon(SUBTOTAL, coupon);
   $("disc").textContent = `-${money(discount)}`;
   $("total").textContent = money(total);

===================================================================
--- a/public/js/lib/pricing.js
+++ b/public/js/lib/pricing.js
@@ -2,7 +2,9 @@

 /** Applies a coupon from GET /api/coupons/:code to a subtotal. */
 export function applyCoupon(subtotal, coupon) {
-  const discount = (subtotal * coupon.discount?.rate) / 100;
+  const rate = Number(coupon.percent_off);
+  if (!Number.isFinite(rate)) return { discount: 0, total: subtotal };
+  const discount = (subtotal * rate) / 100;
   return { discount, total: subtotal - discount };
 }
```

### profile-silent-500

The profile row exposes its display name as the `name` column, but the API updated a nonexistent `display_name` column, causing every save to fail. The route now updates `name`; the client also checks `res.ok` so the success toast is only shown for a successful response, while failures produce an error toast.

```diff
===================================================================
--- a/public/js/profile.js
+++ b/public/js/profile.js
@@ -1,6 +1,6 @@
 const $ = (id) => document.getElementById(id);

 $("save").addEventListener("click", async () => {
-  await fetch("/api/profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: $("name").value }) });
-  toast("Profile saved ✓");
+  const res = await fetch("/api/profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: $("name").value }) });
+  toast(res.ok ? "Profile saved ✓" : "Unable to save profile");
 });

===================================================================
--- a/server.mjs
+++ b/server.mjs
@@ -109,7 +109,7 @@
       if (req.method === "POST") {
         const body = JSON.parse((await readBody(req)) || "{}");
         try {
-          updateProfile("display_name", String(body.displayName ?? "").slice(0, 80));
+          updateProfile("name", String(body.displayName ?? "").slice(0, 80));
         } catch (e) {
           return send(res, 500, JSON.stringify({ error: e.message }), "application/json");
         }
```

### orders-dead-link

The Orders navigation entry points to `/account/orders`, but the orders page is registered under `/orders` in the `pages` route table, so the server correctly renders its 404 for the stale path. Pointing the link at the registered route makes the header navigate to the existing orders list.

```diff
===================================================================
--- a/server.mjs
+++ b/server.mjs
@@ -23,7 +23,7 @@
   ["Checkout", "/checkout"],
   ["Profile", "/profile"],
   ["Settings", "/settings"],
-  ["Orders", "/account/orders"],
+  ["Orders", "/orders"],
 ];

 const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
```

### email-plus-rejected

The custom `isValidEmail` regex allowed only `[A-Za-z0-9._-]` in the local part and a single-label domain, so `+` sub-addresses and multi-level domains were rejected client-side before any request was made. I replaced it with a standards-oriented pattern that supports RFC-style local-part characters (including `+`) and multi-label domains, and made the Settings save actually POST and persist the value through a new `/api/settings` endpoint that revalidates server-side, with the client showing an error if the server rejects the save.

```diff
===================================================================
--- a/public/js/lib/validate.js
+++ b/public/js/lib/validate.js
@@ -1,5 +1,7 @@
 // Form validation.

+const EMAIL = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;
+
 export function isValidEmail(value) {
-  return /^[a-z0-9.]+@[a-z0-9-]+\.[a-z]+$/i.test(value.trim());
+  return EMAIL.test(value.trim());
 }

===================================================================
--- a/public/js/settings.js
+++ b/public/js/settings.js
@@ -2,13 +2,18 @@

 const $ = (id) => document.getElementById(id);

-$("save").addEventListener("click", () => {
-  const value = $("email").value;
+$("save").addEventListener("click", async () => {
+  const value = $("email").value.trim();
   if (!isValidEmail(value)) {
     $("err").textContent = "Please enter a valid email address.";
     console.warn("email validation failed", value);
     return;
   }
+  const res = await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: value }) });
+  if (!res.ok) {
+    $("err").textContent = "Could not save settings. Please try again.";
+    return;
+  }
   $("err").textContent = "";
   toast("Settings saved ✓");
 });

===================================================================
--- a/server.mjs
+++ b/server.mjs
@@ -4,6 +4,7 @@
 import { createServer } from "node:http";
 import { extname, join } from "node:path";
 import { fileURLToPath } from "node:url";
+import { isValidEmail } from "./public/js/lib/validate.js";

 export const LOGIN = { email: "demo@shop.test", password: "demo1234" };
 const SESSION = "sid=bench-session-7f3a";
@@ -45,7 +46,7 @@
     ),
   "/profile": () => layout("Profile", `<h1>Profile</h1><label for="name">Display name</label><input id="name" value="${esc(profile.name)}"><p><button id="save">Save changes</button></p>`, "profile"),
   "/settings": () =>
-    layout("Settings", `<h1>Notification settings</h1><label for="email">Alert email</label><input id="email" value="${esc(profile.email)}"><p class="err" id="err"></p><p><button id="save">Save settings</button></p>`, "settings"),
+    layout("Settings", `<h1>Notification settings</h1><label for="email">Alert email</label><input id="email" type="email" value="${esc(profile.email)}"><p class="err" id="err"></p><p><button id="save">Save settings</button></p>`, "settings"),
   "/cart": () =>
     layout(
       "Cart",
@@ -117,6 +118,16 @@
       }
       return send(res, 200, JSON.stringify(profile), "application/json");
     }
+    if (url.pathname === "/api/settings") {
+      if (req.method === "POST") {
+        const body = JSON.parse((await readBody(req)) || "{}");
+        const email = String(body.email ?? "").trim();
+        if (!isValidEmail(email)) return send(res, 400, JSON.stringify({ error: "invalid email" }), "application/json");
+        updateProfile("email", email);
+        return send(res, 200, JSON.stringify(profile), "application/json");
+      }
+      return send(res, 200, JSON.stringify(profile), "application/json");
+    }
     if (url.pathname === "/") return send(res, 303, "", "text/plain", { location: "/checkout" });
     const page = pages[url.pathname];
     if (!page) return send(res, 404, layout("Not found", `<h1>Page not found</h1><p>We couldn't find ${esc(url.pathname)}.</p>`));
```

### cart-plus-two

The cart's "+" listener calls `nextQuantity` exactly once per click, but `nextQuantity` in `public/js/lib/cart.js` increments by 2 (`q + 2`), so a quantity of 1 becomes 3 and the subtotal becomes 3 × price. Changing the step to 1 makes one click yield 2 while preserving the max-quantity clamp.

```diff
===================================================================
--- a/public/js/lib/cart.js
+++ b/public/js/lib/cart.js
@@ -3,7 +3,7 @@
 export const MAX_QUANTITY = 10;

 export function nextQuantity(q) {
-  return Math.min(MAX_QUANTITY, q + 2);
+  return Math.min(MAX_QUANTITY, q + 1);
 }

 export function previousQuantity(q) {
```

### checkout-overflow-mobile

The horizontal overflow came from the coupon row's hard-coded `min-width: 460px`, which forced its children beyond the card at mobile widths. Removing that floor and allowing the label and button to occupy full-width lines on small screens keeps the row within the card, while increasing the header links' height and padding fixes their undersized tap targets.

```diff
===================================================================
--- a/public/styles.css
+++ b/public/styles.css
@@ -2,11 +2,11 @@
 body { font: 15px/1.5 system-ui, -apple-system, sans-serif; margin: 0; background: #f7f9fa; color: #262626; }
 header { background: #fff; border-bottom: 1px solid #e8e8e8; padding: 0 24px; min-height: 56px; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 20px; }
 header b { margin-right: auto; }
-header a { color: #262626; text-decoration: none; font-size: 14px; }
+header a { color: #262626; text-decoration: none; font-size: 14px; display: inline-flex; align-items: center; min-height: 44px; padding: 0 8px; }
 main { max-width: 560px; margin: 32px auto; background: #fff; border: 1px solid #e8e8e8; padding: 28px; }
 h1 { font-size: 24px; margin: 0 0 16px; letter-spacing: -.02em; }
 .row { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid #f0f0f0; }
-.coupon-row { min-width: 460px; }
+.coupon-row { min-width: 0; }
 button { background: #0070d5; color: #fff; border: 0; border-radius: 999px; padding: 8px 18px; font: inherit; cursor: pointer; white-space: nowrap; }
 button.ghost { background: #fff; color: #262626; border: 1px solid #262626; }
 input { font: inherit; padding: 8px 10px; border: 1px solid #d9d9d9; border-radius: 4px; width: 240px; max-width: 100%; }
@@ -16,4 +16,4 @@
 .toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: #262626; color: #fff; padding: 10px 18px; border-radius: 999px; display: none; }
 .qty { display: flex; gap: 10px; align-items: center; }
 .qty button { width: 32px; height: 32px; padding: 0; }
-@media (max-width: 600px) { main { margin: 0; border: 0; padding: 20px 16px; } }
+@media (max-width: 600px) { main { margin: 0; border: 0; padding: 20px 16px; } .coupon-row { flex-wrap: wrap; } .coupon-row > label { flex: 1 1 100%; min-width: 0; } .coupon-row > button { flex: 1 1 100%; } }
```
