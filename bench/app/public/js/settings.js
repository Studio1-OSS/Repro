import { isValidEmail } from "./lib/validate.js";

const $ = (id) => document.getElementById(id);

$("save").addEventListener("click", () => {
  const value = $("email").value;
  if (!isValidEmail(value)) {
    $("err").textContent = "Please enter a valid email address.";
    console.warn("email validation failed", value);
    return;
  }
  $("err").textContent = "";
  toast("Settings saved ✓");
});
