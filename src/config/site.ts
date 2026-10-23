// Display text only. The model that actually runs is chosen by NEBIUS_MODEL; this is what the UI names.
export const site = {
  name: "Repro",
  tagline: "Record the bug once. Repro writes it up and reproduces it.",
  description:
    "Open-source bug capture for the browser. Record a bug with its console, network and clicks; MiniMax-M3.1-Flash writes the report and reproduces it in your own logged-in browser.",
  model: {
    name: "MiniMax-M3.1-Flash",
    id: "MiniMaxAI/MiniMax-M3.1-Flash",
    url: "https://tokenfactory.nebius.com/?modals=endpoint-details&model-id=MiniMaxAI/MiniMax-M3.1-Flash",
  },
  provider: { name: "Nebius Token Factory", url: "https://dub.sh/aistudio" },
  repo: "https://github.com/Studio1-OSS/repro",
};
