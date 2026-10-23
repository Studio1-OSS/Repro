import { money } from "./lib/pricing.js";
import { nextQuantity, previousQuantity } from "./lib/cart.js";

const PRICE = 120;
const $ = (id) => document.getElementById(id);
let quantity = 1;

function render() {
  $("qty").textContent = quantity;
  $("sub").textContent = money(quantity * PRICE);
}

$("plus").addEventListener("click", () => {
  quantity = nextQuantity(quantity);
  render();
});
$("minus").addEventListener("click", () => {
  quantity = previousQuantity(quantity);
  render();
});
