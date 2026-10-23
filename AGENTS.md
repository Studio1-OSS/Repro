# AGENTS.md

Guidance for AI coding agents (and humans) working in this repo.

## What this is

Repro: open-source bug capture that also fixes. A Chrome extension (`extension/`, WXT, Manifest V3) records a tab with its console, network and clicks; a Next.js 16 app stores the report and has `MiniMaxAI/MiniMax-M3.1-Flash` on Nebius Token Factory write it up, reproduce it in the user's own browser (the extension drives `chrome.debugger`), propose a fix in the project's code, and check the fix in a local sandbox (Docker, or a plain process). Data lives in SQLite/Turso via Drizzle, auth is Better Auth, media goes to Cloudinary or local disk. See README.md for the full picture.

## Commands

```sh
pnpm install
pnpm db:migrate        # apply drizzle/ migrations to DATABASE_URL (default file:local.db)
pnpm dev               # http://localhost:3000
pnpm ext:build         # extension → extension/.output/chrome-mv3
pnpm ext:release       # rebuild extension/release/repro-extension (committed) and public/repro-extension.zip
pnpm test              # vitest; the page-runtime tests run in a real Chromium when one is installed
pnpm typecheck && pnpm ext:typecheck
pnpm build             # NEXT_DIST_DIR=.next-e2e builds beside a running `pnpm dev`
pnpm sandbox:setup     # pull the sandbox image (Docker) and check for a browser
pnpm smoke:nebius      # live capability table for NEBIUS_MODEL
pnpm bench [--fix]     # live: seeded bugs in bench/app → bench/results.{json,md}; --fix also fixes and sandbox-verifies
pnpm bench:real        # live: public test sites → bench/real-results.{json,md}
pnpm bench:app         # the benchmark app on http://localhost:4400 (demo@shop.test / demo1234)
pnpm e2e               # live: real extension in Playwright's Chromium against APP_URL (the whole flow)
pnpm db:generate       # after editing src/server/db/schema.ts
```

Run `pnpm test && pnpm typecheck && pnpm ext:typecheck` before handing work back. Changes to prompts, the agent or the fixer should come with a `pnpm bench --fix` run.

## Layout

- `src/shared/`: code used by the app, the extension **and** the bench; no server-only imports.
  - `schemas.ts`: every payload, plus the agent guards `blockedActionReason()` and `riskyActionPrompt()`;
  - `page-runtime.js`: plain JS injected into pages: `installCapture()`, `collectPageState()`, `snapshotPage()`, `elementCenter()`, `focusAndClear()`, `focusedIsPassword()`, `selectOption()`, `layoutAudit()`. **Each function must stay self-contained** (no imports, no outer variables): they're injected one by one;
  - `redact.ts`, `logs.ts`, `har.ts` (HAR and cURL), `markdown.ts`.
- `src/server/ai/`: the only place that talks to the model: `nebius.ts` (adapter), `analyze.ts` (report), `agent.ts` (`nextAction()`), `fix.ts` (`proposeFix()`, `applyEdits()`, `renderDiff()`).
- `src/server/source/`: local folders and GitHub (read, PRs, tarballs). `src/server/sandbox/`: providers and `checkFixInSandbox()`. `src/server/browser/`: the Playwright driver and `runAgentSession()` (sandbox, bench, e2e).
- `src/server/services/`: reports, runs, fixes, projects (secrets sealed by `crypto.ts`), tokens, webhook.
- `extension/entrypoints/`: `capture.content.ts` (MAIN world), `bridge.content.ts` (relay, and the web app's postMessage channel), `replay.ts` (rrweb, injected on demand), `offscreen/`, `annotate/`, `popup/`, `background.ts`; `extension/lib/agent-driver.ts` runs the agent loop.
- `bench/app/`: the benchmark app (seeded bugs, its own `node --test` suite). It is a fixture: never present it as a product or use it for demos.

## Rules

- The model is MiniMax-M3.1-Flash for everything. Its display name is hard-coded in `src/config/site.ts`; `NEBIUS_MODEL` only chooses what runs.
- Token Factory doesn't accept video for this model: recordings reach it as timestamped frames.
- Safety is enforced in code: no typing into password fields, the agent stays on the report's origin in its own window, risky clicks need the person's OK, sandbox commands get a scrubbed environment, project secrets are encrypted.
- Redact before anything leaves the browser; the server redacts again.
- After changing the extension, run `pnpm ext:release` so the committed build matches.
- Never commit `.env*`, `*.db`, `.uploads/`, `.next*/` or `DESIGN.md`.
