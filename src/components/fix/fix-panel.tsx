"use client";

import { CheckCircle2, Copy, Download, FlaskConical, GitPullRequest, Loader2, Play, Save, ShieldCheck, Wrench, XCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { site } from "@/config/site";
import { sendToExtension } from "@/lib/extension";
import { readNdjson } from "@/lib/ndjson";
import { cn } from "@/lib/utils";
import { DiffView } from "./diff-view";

type Side = { tests?: { exitCode: number; output: string; durationMs: number }; agent?: { reproduced: boolean | null; evidence: string; steps: number; screenshot?: string } };
type Sandbox = { provider: "docker" | "process"; before: Side; after: Side; verified: boolean; summary: string };
export type FixData = {
  id: string;
  status: "proposed" | "applied" | "pr_opened" | "failed";
  explanation: string;
  diff: string;
  testHint: string | null;
  filesRead: number;
  wholeRepo: boolean;
  sandbox: Sandbox | null;
  prUrl: string | null;
  edits: { path: string }[];
};
export type ProjectInfo = { id: string; name: string; sourceType: "local" | "github"; label: string; canSandbox: boolean };

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/x-diff" }));
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Fix it: the model reads the project's source and proposes a change; check it in the sandbox, apply it, verify it. */
export function FixPanel({
  report,
  project,
  initialFix,
  selfHosted,
}: {
  report: { id: string; pageUrl: string; hasAnalysis: boolean; emulation?: { width: number; height: number; scale: number; mobile: boolean } };
  project: ProjectInfo | null;
  initialFix: FixData | null;
  selfHosted: boolean;
}) {
  const router = useRouter();
  const [fix, setFix] = React.useState<FixData | null>(initialFix);
  const [busy, setBusy] = React.useState<null | "fix" | "sandbox" | "apply" | "pr" | "verify">(null);
  const [log, setLog] = React.useState<string[]>([]);
  const logBox = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => logBox.current?.scrollTo({ top: logBox.current.scrollHeight }), [log]);

  if (!report.hasAnalysis) return null;

  if (!project) {
    return (
      <section className="max-w-xl border border-card-border p-5">
        <p className="eyebrow flex items-center gap-1.5">
          <Wrench className="size-3.5" /> Fix it
        </p>
        <p className="mt-2 text-ui">
          Connect this site&apos;s source code and {site.model.name} will propose a fix, check it in a sandbox and open a pull request.
        </p>
        <Button asChild variant="outline" size="sm" className="mt-4">
          <Link href={`/projects?origin=${encodeURIComponent(new URL(report.pageUrl).origin)}`}>Connect {new URL(report.pageUrl).host}</Link>
        </Button>
      </section>
    );
  }

  async function stream(kind: "fix" | "sandbox", url: string) {
    setBusy(kind);
    setLog([]);
    try {
      await readNdjson(await fetch(url, { method: "POST" }), (msg) => {
        if (msg.type === "progress") setLog((l) => [...l, String(msg.text)]);
        else if (msg.type === "error") throw new Error(String(msg.message));
        else if (msg.type === "done") {
          if (kind === "fix") setFix(msg.fix as FixData);
          else setFix((f) => (f ? { ...f, sandbox: msg.sandbox as Sandbox } : f));
        }
      });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function post(kind: "apply" | "pr") {
    setBusy(kind);
    const res = await fetch(`/api/fixes/${fix!.id}/${kind}`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return toast.error(body.error ?? "That didn't work");
    if (kind === "apply") {
      setFix((f) => (f ? { ...f, status: "applied" } : f));
      toast.success(`Written to ${body.files.join(", ")}. Your dev server should reload; then press Verify.`);
    } else {
      setFix((f) => (f ? { ...f, status: "pr_opened", prUrl: body.url } : f));
      toast.success("Pull request opened");
    }
  }

  async function verifyInBrowser() {
    setBusy("verify");
    if (!(await sendToExtension({ type: "repro:ping" }, 2000))) {
      setBusy(null);
      return toast.error("The Repro extension isn't connected in this browser.");
    }
    const res = await sendToExtension<{ runId?: string; error?: string }>({ type: "repro:reproduce", reportId: report.id, pageUrl: report.pageUrl, purpose: "verify", emulation: report.emulation }, 120_000);
    setBusy(null);
    if (!res) {
      toast("The run is starting slowly. It will appear under Reproduce runs on this report.");
      return router.refresh();
    }
    if (res.error || !res.runId) return toast.error(res.error ?? "Couldn't start the run");
    router.push(`/r/${report.id}/runs/${res.runId}`);
  }

  const sb = fix?.sandbox;
  return (
    <section className="grid gap-5 border-t border-hairline pt-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="eyebrow flex items-center gap-1.5">
          <Wrench className="size-3.5" /> Fix it · {project.label}
        </p>
        {!busy && (
          <Button size="sm" variant={fix ? "outline" : "primary"} onClick={() => stream("fix", `/api/reports/${report.id}/fix`)}>
            <Wrench /> {fix ? "Suggest another fix" : "Suggest a fix"}
          </Button>
        )}
      </div>

      {(busy === "fix" || busy === "sandbox") && (
        <div ref={logBox} className="max-h-48 overflow-y-auto bg-canvas-soft p-3 font-mono text-caption leading-relaxed text-ink-2">
          <p className="mb-1 flex items-center gap-2 font-sans text-ui font-semibold text-ink">
            <Loader2 className="size-4 animate-spin text-primary" /> {busy === "fix" ? `${site.model.name} is reading the code…` : "Checking the fix in the sandbox…"}
          </p>
          {log.map((l, i) => (
            <p key={i}>{l}</p>
          ))}
        </div>
      )}

      {fix && busy !== "fix" && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
          <div className="grid content-start gap-4">
          <div>
            <p className="text-ui">{fix.explanation}</p>
            <p className="mt-1 text-caption text-ink-3">
              {fix.wholeRepo ? `Read the whole codebase (${fix.filesRead} files) in one context.` : `Read ${fix.filesRead} files.`} Changes {new Set(fix.edits.map((e) => e.path)).size} file
              {new Set(fix.edits.map((e) => e.path)).size > 1 ? "s" : ""}.{fix.testHint ? ` Check by hand: ${fix.testHint}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {project.canSandbox && selfHosted && (
              <Button size="sm" variant={sb?.verified ? "outline" : "primary"} loading={busy === "sandbox"} disabled={Boolean(busy)} onClick={() => stream("sandbox", `/api/fixes/${fix.id}/sandbox`)}>
                {busy !== "sandbox" && <FlaskConical />} Check in sandbox
              </Button>
            )}
            {project.sourceType === "local" && selfHosted && (
              <Button size="sm" variant="outline" loading={busy === "apply"} disabled={Boolean(busy) || fix.status === "applied"} onClick={() => post("apply")}>
                {busy !== "apply" && <Save />} {fix.status === "applied" ? "Applied" : "Apply to my folder"}
              </Button>
            )}
            {project.sourceType === "github" &&
              (fix.prUrl ? (
                <Button asChild size="sm" variant="outline">
                  <a href={fix.prUrl} target="_blank" rel="noreferrer">
                    <GitPullRequest /> View pull request
                  </a>
                </Button>
              ) : (
                <Button size="sm" variant="outline" loading={busy === "pr"} disabled={Boolean(busy)} onClick={() => post("pr")}>
                  {busy !== "pr" && <GitPullRequest />} Open pull request
                </Button>
              ))}
            {(fix.status === "applied" || fix.status === "pr_opened") && (
              <Button size="sm" variant="outline" loading={busy === "verify"} disabled={Boolean(busy)} onClick={verifyInBrowser}>
                {busy !== "verify" && <Play />} Verify in my browser
              </Button>
            )}
            <Button
              size="sm"
              variant="quiet"
              onClick={async () => {
                await navigator.clipboard.writeText(fix.diff);
                toast.success("Patch copied");
              }}
            >
              <Copy /> Copy patch
            </Button>
            <Button size="sm" variant="quiet" onClick={() => download(`repro-fix-${fix.id}.patch`, fix.diff)}>
              <Download /> .patch
            </Button>
          </div>
          {!selfHosted && <p className="text-caption text-ink-3">The sandbox and applying to a folder run on self-hosted Repro.</p>}

          {sb && busy !== "sandbox" && (
            <div className={cn("p-4", sb.verified ? "bg-[#ecf8ef]" : "bg-[#fff7e6]")}>
              <p className="flex items-center gap-2 font-semibold">
                {sb.verified ? <ShieldCheck className="size-5 text-ok" /> : <XCircle className="size-5 text-tier" />}
                {sb.verified ? "Fix verified in the sandbox" : "Not verified"}
              </p>
              <p className="mt-1 text-ui text-ink-2">{sb.summary}.</p>
              <p className="mt-1 text-caption text-ink-3">{sb.provider === "docker" ? "Docker container: node:22, 2 CPUs, 2 GB, a throwaway copy of the code." : "Local process on a throwaway copy (Docker wasn't running, so it wasn't isolated)."}</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {(["before", "after"] as const).map((side) => {
                  const s = sb[side];
                  if (!s.tests && !s.agent) return null;
                  return (
                    <div key={side} className="bg-white p-3 text-caption">
                      <p className="font-semibold">{side === "before" ? "Original code" : "With the fix"}</p>
                      {s.tests && (
                        <p className={cn("mt-1 flex items-center gap-1.5", s.tests.exitCode === 0 ? "text-ok" : "text-error")}>
                          {s.tests.exitCode === 0 ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />} Tests {s.tests.exitCode === 0 ? "pass" : "fail"} ({(s.tests.durationMs / 1000).toFixed(1)}s)
                        </p>
                      )}
                      {s.agent && (
                        <p className="mt-1 text-ink-2">
                          Agent: {s.agent.reproduced === true ? "bug reproduced" : s.agent.reproduced === false ? "bug gone" : "no conclusion"} in {s.agent.steps} steps
                        </p>
                      )}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {s.agent?.screenshot && <img src={s.agent.screenshot} alt="" className="mt-2 border border-divider" />}
                      {s.tests && s.tests.exitCode !== 0 && <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-all bg-canvas-soft p-2 text-[11px]">{s.tests.output.slice(-1500)}</pre>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          </div>
          <DiffView diff={fix.diff} />
        </div>
      )}
    </section>
  );
}
