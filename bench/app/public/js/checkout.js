import { applyCoupon, money } from "./lib/pricing.js";

const SUBTOTAL = 144;
const $ = (id) => document.getElementById(id);

$("apply").addEventListener("click", async () => {
  const code = $("coupon").value.trim();
  if (!code) return;
  const res = await fetch(`/api/coupons/${encodeURIComponent(code)}?token=sk_live_51HbenchA7xQ2pLm9`, { headers: { "x-client": "web" } });
  const coupon = await res.json();
  console.log("coupon response", coupon);
  if (!coupon.discount) console.error(new TypeError("Cannot read properties of undefined (reading 'rate')"));
  const { discount, total } = applyCoupon(SUBTOTAL, coupon);
  $("disc").textContent = `-${money(discount)}`;
  $("total").textContent = money(total);
});

$("pay").addEventListener("click", () => {
  $("msg").textContent = "Payments are disabled in this test store.";
});
