"use client";

import { CheckCircle2, Copy } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { sendToExtension } from "@/lib/extension";

type State = { phase: "idle" | "pairing" | "paired" | "manual"; token?: string; appUrl?: string };

export function ConnectExtension() {
  const [state, setState] = React.useState<State>({ phase: "idle" });
  const [installed, setInstalled] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    sendToExtension<{ ok: boolean }>({ type: "repro:ping" }, 1500).then((r) => setInstalled(Boolean(r?.ok)));
  }, []);

  async function pair() {
    setState({ phase: "pairing" });
    const res = await fetch("/api/extension/token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label: navigator.userAgent.includes("Edg/") ? "Edge" : "Chrome" }) });
    if (!res.ok) {
      toast.error("Couldn't create a token");
      return setState({ phase: "idle" });
    }
    const { token, appUrl } = (await res.json()) as { token: string; appUrl: string };
    const ack = await sendToExtension<{ ok: boolean }>({ type: "repro:pair", token, appUrl });
    setState(ack?.ok ? { phase: "paired" } : { phase: "manual", token, appUrl });
  }

  if (state.phase === "paired") {
    return (
      <div className="mt-8 bg-[#ecf8ef] p-6">
        <p className="flex items-center gap-2 text-subhead font-semibold">
          <CheckCircle2 className="size-5 text-ok" /> Connected
        </p>
        <p className="mt-2 text-ink-2">Open any page, click the Repro icon in the toolbar and press Record when something goes wrong.</p>
        <Button asChild className="mt-5">
          <Link href="/dashboard">Go to reports</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-8 grid gap-4">
      <div className="flex items-center gap-2 text-ui">
        <span className={installed ? "size-2.5 rounded-full bg-ok" : installed === false ? "size-2.5 rounded-full bg-warn" : "size-2.5 rounded-full bg-card-border"} />
        {installed === null ? "Looking for the extension…" : installed ? "Repro extension found in this browser" : "Extension not detected (pairing by copy and paste still works)"}
      </div>
      <div>
        <Button size="lg" onClick={pair} loading={state.phase === "pairing"}>
          Connect this browser
        </Button>
      </div>
      {!installed && installed !== null && (
        <p className="text-ui text-ink-2">
          Not installed yet? <Link href="/install" className="text-primary hover:underline">Install the extension</Link> (it takes a minute), then come back.
        </p>
      )}
      {state.phase === "manual" && state.token && (
        <div className="border border-card-border p-5">
          <p className="font-semibold">Paste this into the extension</p>
          <p className="mt-1 text-ui text-ink-2">Open the Repro extension popup, choose “Paste a token” and paste it. It's shown once.</p>
          <div className="mt-3 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate bg-canvas-soft px-3 py-2 font-mono text-caption">{`${state.appUrl}#${state.token}`}</code>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await navigator.clipboard.writeText(`${state.appUrl}#${state.token}`);
                toast.success("Copied");
              }}
            >
              <Copy /> Copy
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
