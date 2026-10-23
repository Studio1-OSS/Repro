const $ = (id) => document.getElementById(id);

$("save").addEventListener("click", async () => {
  await fetch("/api/profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: $("name").value }) });
  toast("Profile saved ✓");
});
