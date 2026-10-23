// Benchmark fixture for Repro: a small store with a sign-in and seeded bugs (see ../bugs.ts).
// No dependencies:  node server.mjs   → http://localhost:4400 (sign in: demo@shop.test / demo1234)
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const LOGIN = { email: "demo@shop.test", password: "demo1234" };
const SESSION = "sid=bench-session-7f3a";
const PUBLIC = fileURLToPath(new URL("./public/", import.meta.url));
const TYPES = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

// A tiny in-memory "profiles" table.
const profile = { name: "Priya Sharma", email: "priya@example.com" };
const COLUMNS = ["name", "email"];
function updateProfile(column, value) {
  if (!COLUMNS.includes(column)) throw new Error(`column "${column}" of relation "profiles" does not exist`);
  profile[column] = value;
}

const NAV = [
  ["Cart", "/cart"],
  ["Checkout", "/checkout"],
  ["Profile", "/profile"],
  ["Settings", "/settings"],
  ["Orders", "/account/orders"],
];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const layout = (title, body, script = "") => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} · Acme Outfitters</title><link rel="stylesheet" href="/static/styles.css"></head><body>
<header><b>Acme Outfitters</b>${NAV.map(([label, href]) => `<a href="${href}">${label}</a>`).join("")}<a href="/logout" id="logout">Sign out</a></header>
<main>${body}</main><div class="toast" id="toast"></div>
<script>function toast(m){var t=document.getElementById('toast');t.textContent=m;t.style.display='block';setTimeout(function(){t.style.display='none'},2500)}</script>
${script ? `<script type="module" src="/static/js/${script}.js"></script>` : ""}</body></html>`;

const pages = {
  "/checkout": () =>
    layout(
      "Checkout",
      `<h1>Checkout</h1><div class="row"><span>Trail runners ×1</span><span>$120.00</span></div><div class="row"><span>Wool socks ×2</span><span>$24.00</span></div>
<div class="row coupon-row"><label style="margin:0">Coupon <input id="coupon" placeholder="Enter code" style="width:150px"></label><button id="apply">Apply coupon</button></div>
<div class="row"><span>Discount</span><span id="disc">$0.00</span></div><div class="row total"><span>Total</span><span id="total">$144.00</span></div>
<p><button id="pay" class="ghost">Place order</button></p><p class="err" id="msg"></p>`,
      "checkout",
    ),
  "/profile": () => layout("Profile", `<h1>Profile</h1><label for="name">Display name</label><input id="name" value="${esc(profile.name)}"><p><button id="save">Save changes</button></p>`, "profile"),
  "/settings": () =>
    layout("Settings", `<h1>Notification settings</h1><label for="email">Alert email</label><input id="email" value="${esc(profile.email)}"><p class="err" id="err"></p><p><button id="save">Save settings</button></p>`, "settings"),
  "/cart": () =>
    layout(
      "Cart",
      `<h1>Your cart</h1><div class="row"><span>Trail runners</span><span class="qty"><button id="minus" aria-label="Decrease quantity">−</button><span id="qty">1</span><button id="plus" aria-label="Increase quantity">+</button></span></div>
<div class="row total"><span>Subtotal</span><span id="sub">$120.00</span></div>`,
      "cart",
    ),
  "/orders": () => layout("Orders", `<h1>Your orders</h1><div class="row"><span>#1042 · Trail runners</span><span>Delivered</span></div><div class="row"><span>#1039 · Rain jacket</span><span>Delivered</span></div>`),
};

function send(res, status, body, type = "text/html; charset=utf-8", headers = {}) {
  res.writeHead(status, { "content-type": type, ...headers });
  res.end(body);
}

async function readBody(req) {
  let data = "";
  for await (const chunk of req) data += chunk;
  return data;
}

export function startServer(port = Number(process.env.PORT || 4400)) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    const signedIn = (req.headers.cookie ?? "").includes(SESSION);

    if (url.pathname.startsWith("/static/")) {
      const file = join(PUBLIC, url.pathname.slice("/static/".length));
      if (!file.startsWith(PUBLIC)) return send(res, 404, "Not found", "text/plain");
      try {
        return send(res, 200, await readFile(file), TYPES[extname(file)] ?? "application/octet-stream");
      } catch {
        return send(res, 404, "Not found", "text/plain");
      }
    }
    if (url.pathname === "/login") {
      if (req.method === "POST") {
        const form = new URLSearchParams(await readBody(req));
        if (form.get("email") === LOGIN.email && form.get("password") === LOGIN.password) {
          return send(res, 303, "", "text/plain", { location: url.searchParams.get("next") || "/checkout", "set-cookie": `${SESSION}; Path=/; HttpOnly; SameSite=Lax` });
        }
        return send(res, 401, layout("Sign in", `<h1>Sign in</h1><p class="err">Wrong email or password.</p><a href="/login">Try again</a>`));
      }
      return send(
        res,
        200,
        layout("Sign in", `<h1>Sign in</h1><form method="post"><label for="e">Email</label><input id="e" name="email" value="${LOGIN.email}"><label for="p">Password</label><input id="p" name="password" type="password"><p><button>Sign in</button></p></form>`),
      );
    }
    if (url.pathname === "/logout") return send(res, 303, "", "text/plain", { location: "/login", "set-cookie": "sid=; Path=/; Max-Age=0" });
    if (!signedIn) {
      if (url.pathname.startsWith("/api/")) return send(res, 401, JSON.stringify({ error: "not signed in" }), "application/json");
      return send(res, 303, "", "text/plain", { location: `/login?next=${encodeURIComponent(url.pathname)}` });
    }

    if (url.pathname.startsWith("/api/coupons/")) {
      const code = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      return send(res, 200, JSON.stringify({ code, valid: true, percent_off: 10 }), "application/json");
    }
    if (url.pathname === "/api/profile") {
      if (req.method === "POST") {
        const body = JSON.parse((await readBody(req)) || "{}");
        try {
          updateProfile("display_name", String(body.displayName ?? "").slice(0, 80));
        } catch (e) {
          return send(res, 500, JSON.stringify({ error: e.message }), "application/json");
        }
        return send(res, 200, JSON.stringify(profile), "application/json");
      }
      return send(res, 200, JSON.stringify(profile), "application/json");
    }
    if (url.pathname === "/") return send(res, 303, "", "text/plain", { location: "/checkout" });
    const page = pages[url.pathname];
    if (!page) return send(res, 404, layout("Not found", `<h1>Page not found</h1><p>We couldn't find ${esc(url.pathname)}.</p>`));
    return send(res, 200, page());
  });
  return new Promise((resolve) => server.listen(port, () => resolve({ url: `http://localhost:${server.address().port}`, close: () => server.close() })));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { url } = await startServer();
  console.log(`Bench app on ${url}  (sign in: ${LOGIN.email} / ${LOGIN.password})`);
}
