"use client";

import { Check, Copy, Github, Link2, Play } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { sendToExtension } from "@/lib/extension";
import { analysisToMarkdown } from "@/shared/markdown";
import type { Analysis } from "@/shared/schemas";
import type { ReportData } from "./types";

const REPO_KEY = "repro:github-repo";

export function ReportActions({ report, analysis, appUrl }: { report: ReportData; analysis: Analysis | null; appUrl: string }) {
  const router = useRouter();
  const [shared, setShared] = React.useState(report.shared);
  const [starting, setStarting] = React.useState(false);
  const shareUrl = `${appUrl}/s/${report.shareSlug}`;
  const markdown = () =>
    analysis ? analysisToMarkdown(analysis, { pageUrl: report.pageUrl, reportUrl: shared ? shareUrl : `${appUrl}/r/${report.id}`, device: report.device }) : "";

  async function toggleShare() {
    const next = !shared;
    const res = await fetch(`/api/reports/${report.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ shared: next }) });
    if (!res.ok) return toast.error("Couldn't change sharing");
    setShared(next);
    if (next) {
      await navigator.clipboard.writeText(shareUrl).catch(() => {});
      toast.success("Share link copied. Anyone with it can view this report.");
    } else toast("Share link turned off");
  }

  async function reproduce() {
    setStarting(true);
    const d = report.device;
    // Reproduce at the size the bug was recorded at.
    const emulation = d.emulated ? { width: d.viewport.width, height: d.viewport.height, scale: d.pixelRatio, mobile: d.viewport.width < 900 } : undefined;
    // The extension answers once the agent's first step is back from the model, which can take a while.
    const ping = await sendToExtension<{ ok: boolean }>({ type: "repro:ping" }, 2000);
    if (!ping) {
      setStarting(false);
      toast.error("The Repro extension isn't connected in this browser.", { action: { label: "Set it up", onClick: () => router.push("/install") } });
      return;
    }
    const res = await sendToExtension<{ runId?: string; error?: string }>({ type: "repro:reproduce", reportId: report.id, pageUrl: report.pageUrl, emulation }, 120_000);
    setStarting(false);
    if (!res) {
      toast("The run is starting slowly. It will appear under Reproduce runs on this report.");
      router.refresh();
      return;
    }
    if (res.error || !res.runId) return toast.error(res.error ?? "The extension couldn't start the run");
    router.push(`/r/${report.id}/runs/${res.runId}`);
  }

  function openIssue() {
    const saved = localStorage.getItem(REPO_KEY) ?? "";
    const repo = window.prompt("GitHub repository (owner/name)", saved)?.trim();
    if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return;
    localStorage.setItem(REPO_KEY, repo);
    const body = markdown().slice(0, 6000);
    window.open(`https://github.com/${repo}/issues/new?title=${encodeURIComponent(analysis?.title ?? report.title)}&body=${encodeURIComponent(body)}`, "_blank", "noopener");
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={toggleShare}>
        {shared ? <Check /> : <Link2 />} {shared ? "Shared" : "Share"}
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={!analysis}
        onClick={async () => {
          await navigator.clipboard.writeText(markdown());
          toast.success("Copied as a GitHub issue (Markdown)");
        }}
      >
        <Copy /> Copy as issue
      </Button>
      <Button variant="outline" size="sm" disabled={!analysis} onClick={openIssue}>
        <Github /> Open issue
      </Button>
      <Button size="sm" onClick={reproduce} loading={starting}>
        {!starting && <Play />} Reproduce in my browser
      </Button>
      {shared && (
        <Link href={`/s/${report.shareSlug}`} className="text-ui text-primary hover:underline" target="_blank">
          View shared page ›
        </Link>
      )}
    </div>
  );
}
