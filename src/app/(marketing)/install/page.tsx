import { Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { site } from "@/config/site";

export const metadata: Metadata = { title: "Install the extension" };

const code = (s: string) => <code className="bg-fog px-1.5 py-0.5 font-mono text-ui">{s}</code>;

const steps: { title: string; body: React.ReactNode; action?: React.ReactNode }[] = [
  {
    title: "Download it",
    body: (
      <>
        Download the extension and unzip it. It&apos;s also in the repository, ready to load, at {code("extension/release/repro-extension")}.
      </>
    ),
    action: (
      <Button asChild className="mt-4">
        <a href="/repro-extension.zip" download>
          <Download /> Download repro-extension.zip
        </a>
      </Button>
    ),
  },
  {
    title: "Load it in Chrome",
    body: (
      <>
        Open {code("chrome://extensions")}, turn on <b className="font-semibold">Developer mode</b> (top right), click <b className="font-semibold">Load unpacked</b> and choose the unzipped folder. Pin Repro to the toolbar. Tested in Chrome and
        Chromium; Edge and Brave should work the same way.
      </>
    ),
  },
  {
    title: "Connect it to your account",
    body: (
      <>
        Sign in here and open <Link href="/connect" className="text-primary hover:underline">Connect</Link>. One click pairs the extension with this Repro app, wherever it&apos;s hosted; the token stays in the extension.
      </>
    ),
  },
  {
    title: "Record a bug",
    body: "On any page, click the Repro icon, say what went wrong, then record the tab, take a screenshot, check the layout at five sizes, or turn on instant replay and save the last minute.",
  },
];

export default function InstallPage() {
  return (
    <div className="container-page max-w-3xl py-16">
      <p className="eyebrow">Install</p>
      <h1 className="mt-2 text-display font-semibold">Install the Repro extension</h1>
      <p className="mt-4 text-ink-2">
        Repro isn&apos;t on the Chrome Web Store yet, so you load it yourself. It takes about a minute, and the same build works with any Repro app, local or deployed. The extension is store-ready (Manifest V3) if you want to publish your own build.
      </p>
      <ol className="mt-10 grid gap-4">
        {steps.map((s, i) => (
          <li key={s.title} className="grid gap-4 bg-canvas-soft p-6 sm:grid-cols-[48px_1fr]">
            <span className="text-display font-normal leading-none text-card-border">{i + 1}</span>
            <div className="min-w-0">
              <h2 className="text-title font-semibold">{s.title}</h2>
              <p className="mt-2 text-ink-2">{s.body}</p>
              {s.action}
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-6 bg-canvas-soft p-6 text-ui text-ink-2">
        <p className="font-semibold text-ink">Building it yourself</p>
        <pre className="mt-3 overflow-x-auto bg-footer p-4 font-mono text-[13px] leading-6 text-white/85">pnpm install{"\n"}pnpm ext:build      # → extension/.output/chrome-mv3{"\n"}pnpm ext:release    # → the release folder and the zip</pre>
      </div>
      <div className="mt-10 border-t border-hairline pt-8">
        <h2 className="text-subhead font-semibold">What the extension can access</h2>
        <ul className="mt-3 grid gap-2 text-ui text-ink-2">
          <li>
            • <b className="font-semibold text-ink">Pages you visit</b>: a small script keeps the last 30 seconds of console and network activity inside the tab, so it&apos;s there when you report. Nothing is sent until you do.
          </li>
          <li>
            • <b className="font-semibold text-ink">Tab capture</b>: records only the tab you choose, only while recording.
          </li>
          <li>
            • <b className="font-semibold text-ink">Instant replay</b>: off by default. When you switch it on for a tab, the last minute of that page&apos;s DOM is kept in the tab until you save it.
          </li>
          <li>
            • <b className="font-semibold text-ink">Debugger</b>: used for Reproduce (only in the window the agent opens), for recording at a device size, and for layout checks. Chrome shows a banner while it&apos;s attached.
          </li>
        </ul>
        <div className="mt-8 flex gap-3">
          <Button asChild>
            <Link href="/connect">Connect the extension</Link>
          </Button>
          <Button asChild variant="outline">
            <a href={site.repo} target="_blank" rel="noreferrer">
              Source on GitHub
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}
