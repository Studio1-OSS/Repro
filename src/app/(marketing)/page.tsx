import { ArrowRight, Braces, CheckCircle2, Eye, FlaskConical, KeyRound, Layers, LayoutPanelLeft, MousePointerClick, Network, ShieldCheck, Smartphone, Sparkles, Terminal, Video, Wrench } from "lucide-react";
import Link from "next/link";
import bench from "../../../bench/results.json";
import real from "../../../bench/real-results.json";
import { HeroShowcase } from "@/components/landing/hero-showcase";
import { Button } from "@/components/ui/button";
import { site } from "@/config/site";

const s = bench.summary;
const realOk = real.filter((r) => r.ok).length;

export default function LandingPage() {
  return (
    <>
      {/* Hero */}
      <section className="overflow-hidden bg-media pb-24 pt-20 text-white">
        <div className="container-page text-center">
          <p className="text-caption text-[#fa8c16]">Open-source bug capture · Powered by {site.model.name}</p>
          <h1 className="mx-auto mt-4 max-w-4xl text-[40px] font-semibold leading-[1.05] tracking-[-0.035em] sm:text-[64px]">
            Record the bug once.
            <span className="block text-white/55">Repro reproduces it, then fixes it.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-[17px] text-white/70">
            One click captures the screen, console, network and every click. {site.model.name} writes the report, reproduces the bug in your own signed-in browser, proposes a fix in your code and proves it in a sandbox.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link href="/install">Install the extension</Link>
            </Button>
            <Button asChild size="lg" variant="ghost">
              <Link href="#demo">See it run</Link>
            </Button>
          </div>
          <HeroShowcase />
        </div>
      </section>

      {/* Stats strip */}
      <section className="border-b border-hairline">
        <div className="container-page grid grid-cols-2 gap-y-8 py-12 text-center md:grid-cols-4">
          {[
            [`${s.reproduced}/${s.bugs}`, "seeded bugs reproduced by the agent"],
            [`${s.fixesVerified}/${s.fixAttempts}`, "fixes verified in the sandbox"],
            [`${realOk}/${real.length}`, "real-site cases right, on public test apps"],
            [`${s.avgAgentSteps.toFixed(1)}`, "average agent steps to reproduce"],
          ].map(([value, label]) => (
            <div key={label}>
              <p className="text-display font-normal tracking-[-0.03em]">{value}</p>
              <p className="mx-auto mt-1 max-w-[190px] text-ui text-ink-2">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Demo video */}
      <section id="demo" className="scroll-mt-20 py-16">
        <div className="container-page">
          <div className="mx-auto max-w-2xl text-center">
            <p className="eyebrow">See it run</p>
            <h2 className="mt-2 text-display font-semibold">A real session, start to finish.</h2>
            <p className="mt-3 text-ink-2">
              Repro on saucedemo&apos;s open-source app, running locally: instant replay of a broken sort, the AI report, the agent reproducing it, a fix checked in a Docker sandbox, applied, and verified in the browser. Recorded as it happened; waiting is sped up.
            </p>
          </div>
          <div className="mx-auto mt-10 max-w-5xl overflow-hidden border border-divider bg-media">
            <video controls preload="metadata" playsInline poster="/demo/repro-demo-poster.jpg" className="block aspect-[16/10] w-full">
              <source src="/demo/repro-demo.mp4" type="video/mp4" />
            </video>
          </div>
        </div>
      </section>

      {/* Feature tiles */}
      <section className="bg-canvas-soft py-16">
        <div className="container-page">
          <div className="mx-auto max-w-2xl text-center">
            <p className="eyebrow">Record · Report · Reproduce · Fix</p>
            <h2 className="mt-2 text-display font-semibold">From &ldquo;it&apos;s broken&rdquo; to a verified fix.</h2>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-2">
            <Tile eyebrow="Capture" title="One click, the whole story" body="Record the tab, take an annotated screenshot, or save the last 60 seconds with instant replay. Console, every fetch and XHR with bodies, clicks, inputs, navigations and device details come along on one timeline.">
              <div className="grid gap-1.5 font-mono text-[12px]">
                <Row icon={<MousePointerClick className="size-3.5" />} t="0:03" text='select "Price (low to high)"' />
                <Row icon={<Network className="size-3.5" />} t="0:03" text="POST /api/events → 200" />
                <Row icon={<Terminal className="size-3.5" />} t="0:04" text="TypeError: Cannot read 'xyz'" tone="error" />
                <Row icon={<Video className="size-3.5" />} t="0:05" text="Products still in the old order" />
              </div>
            </Tile>
            <Tile eyebrow={site.model.name} title="A report you can act on" body="The model reads the frames and every log line at once: timestamped steps, expected versus actual, the likely cause with the log lines that prove it, and security findings such as leaked keys.">
              <div className="bg-white p-4 text-[13px]">
                <p className="font-semibold">Likely cause</p>
                <p className="mt-1 text-ink-2">The coupon API returns <code className="bg-fog px-1">percent_off</code> but the handler reads <code className="bg-fog px-1">discount.rate</code>, so the total becomes NaN.</p>
                <p className="mt-3 flex items-center gap-1.5 bg-[#fff1f0] px-2 py-1.5 text-[12px]">
                  <KeyRound className="size-3.5 text-error" /> Live API key sent in a request URL
                </p>
              </div>
            </Tile>
            <Tile eyebrow="Computer use" title="Reproduced in your own browser" body="Press Reproduce and the agent opens a window in your browser, already signed in, and clicks through the steps while you watch. It only says ✓ when the bug really happened, and asks before anything risky.">
              <div className="grid gap-2 bg-white p-4 text-[13px]">
                <p className="flex items-center gap-2"><span className="grid size-5 place-items-center rounded-full bg-primary-tint text-[10px] font-semibold text-primary-strong">1</span> Choose &ldquo;Price (low to high)&rdquo;</p>
                <p className="flex items-center gap-2"><span className="grid size-5 place-items-center rounded-full bg-primary-tint text-[10px] font-semibold text-primary-strong">2</span> Compare the first two prices</p>
                <p className="flex items-center gap-2 font-semibold text-ok"><CheckCircle2 className="size-4" /> Order unchanged: reproduced</p>
              </div>
            </Tile>
            <Tile eyebrow="Fix it" title="A fix, checked before you apply it" body="Connect a local folder or a GitHub repo. The model reads the code (the whole codebase when it fits), proposes a minimal change, runs your tests and the reproduce agent on the patched copy in a Docker sandbox, then applies it or opens a pull request.">
              <div className="grid gap-1.5 font-mono text-[12px]">
                <p className="bg-[#fff1f0] px-3 py-1.5 text-[#a8071a]">- (subtotal * coupon.discount?.rate) / 100</p>
                <p className="bg-[#ecf8ef] px-3 py-1.5 text-[#135200]">+ (subtotal * Number(coupon.percent_off)) / 100</p>
                <p className="flex items-center gap-1.5 bg-white px-3 py-2 font-sans text-[12px]"><FlaskConical className="size-3.5 text-ok" /> Tests pass · the agent can no longer reproduce it</p>
              </div>
            </Tile>
            <Tile eyebrow="Responsive" title="Layout bugs at every size" body="Record at an iPhone, Pixel or iPad size, or check a page at five widths in one click. Repro measures overflow, clipped text, overlaps and tiny tap targets, and the model confirms each against the screenshots.">
              <div className="flex items-end gap-2">
                {[360, 390, 768, 1024, 1440].map((w, i) => (
                  <div key={w} className="flex flex-col items-center gap-1">
                    <span className={`block border ${i < 2 ? "border-error bg-[#fff1f0]" : "border-card-border bg-white"}`} style={{ width: 14 + i * 14, height: 46 }} />
                    <span className="text-[11px] text-ink-3">{w}</span>
                  </div>
                ))}
                <span className="ml-3 flex items-center gap-1.5 text-[12px] text-error"><Smartphone className="size-3.5" /> 70px overflow at 360</span>
              </div>
            </Tile>
            <Tile eyebrow="For developers" title="DevTools for the moment it broke" body="Console with filters, a network waterfall with Copy as cURL and HAR export, performance (LCP, CLS, INP, long tasks), storage, and a DOM replay you can right-click and Inspect with your own DevTools.">
              <div className="grid grid-cols-4 gap-px bg-hairline text-center text-[12px]">
                {[["LCP", "1.9 s"], ["CLS", "0.02"], ["INP", "120 ms"], ["Long tasks", "3"]].map(([k, v]) => (
                  <div key={k} className="bg-white py-3">
                    <p className="text-ink-3">{k}</p>
                    <p className="mt-0.5 font-semibold">{v}</p>
                  </div>
                ))}
              </div>
            </Tile>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="scroll-mt-20 py-16">
        <div className="container-page">
          <div className="mx-auto max-w-2xl text-center">
            <p className="eyebrow">How it works</p>
            <h2 className="mt-2 text-display font-semibold">Four steps, all in your browser.</h2>
          </div>
          <ol className="mt-12 grid gap-4 md:grid-cols-4">
            {[
              ["Record", "Click the Repro icon, say what went wrong, and record, screenshot or save the last minute.", Video],
              ["Read the report", `Frames, actions and every log line go to ${site.model.name} in one call. The report streams in.`, Eye],
              ["Reproduce", "The agent replays the steps in a fresh window of your browser and stops the moment it sees the bug.", MousePointerClick],
              ["Fix and verify", "The model proposes a change; the sandbox runs your tests and the agent on it; you apply it or open a PR.", Wrench],
            ].map(([title, body, Icon], i) => {
              const I = Icon as typeof Video;
              return (
                <li key={title as string} className="bg-fog p-7">
                  <div className="flex items-center justify-between">
                    <span className="text-display font-normal text-card-border">0{i + 1}</span>
                    <I className="size-6 text-primary" />
                  </div>
                  <h3 className="mt-6 text-title font-semibold">{title as string}</h3>
                  <p className="mt-2 text-ink-2">{body as string}</p>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      {/* Benchmark */}
      <section id="bench" className="scroll-mt-20 bg-canvas-soft py-16">
        <div className="container-page grid items-start gap-12 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <p className="eyebrow">Benchmark</p>
            <h2 className="mt-2 text-display font-semibold">Measured, not promised.</h2>
            <p className="mt-4 text-ink-2">
              <code className="bg-white px-1.5 py-0.5 font-mono text-ui">pnpm bench --fix</code> runs the whole loop on a benchmark app with seeded bugs and a control: record, report, reproduce, fix, and verify each fix in the sandbox with its failing test and the agent.{" "}
              <code className="bg-white px-1.5 py-0.5 font-mono text-ui">pnpm bench:real</code> runs it on public test sites whose bugs are in their own code (saucedemo, the-internet, TodoMVC).
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild variant="outline">
                <a href={`${site.repo}/blob/main/bench/results.md`} target="_blank" rel="noreferrer">
                  Benchmark results <ArrowRight />
                </a>
              </Button>
              <Button asChild variant="outline">
                <a href={`${site.repo}/blob/main/bench/real-results.md`} target="_blank" rel="noreferrer">
                  Real sites <ArrowRight />
                </a>
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[
              [`${s.causeFound}/${s.analysed}`, "reports name the real cause", "including a layout bug from a responsive scan"],
              [`${s.reproduced}/${s.bugs}`, "bugs reproduced", "the agent's claim and the page state both checked"],
              [`${s.fixesVerified}/${s.fixAttempts}`, "fixes verified", "failing test passes, agent can't reproduce it"],
              [`${realOk}/${real.length}`, "real-site cases right", "6 real bugs and a control on public test apps"],
            ].map(([v, l, d]) => (
              <div key={l} className="bg-white p-6">
                <p className="text-display font-normal tracking-[-0.03em]">{v}</p>
                <p className="mt-1 font-semibold">{l}</p>
                <p className="mt-1 text-ui text-ink-2">{d}</p>
              </div>
            ))}
            <p className="col-span-2 text-caption text-ink-3">
              {site.model.name} on {site.provider.name}, {s.date}. A report averages {Math.round(s.avgReportTokens.input).toLocaleString("en-US")} input tokens, a reproduce run {Math.round(s.avgAgentTokens.input).toLocaleString("en-US")}, a fix with its sandbox check{" "}
              {Math.round(s.avgFixTokens!.input).toLocaleString("en-US")}.
            </p>
          </div>
        </div>
      </section>

      {/* Model */}
      <section className="bg-media py-16 text-white">
        <div className="container-page">
          <p className="text-caption text-[#fa8c16]">The model</p>
          <h2 className="mt-2 max-w-3xl text-display font-semibold">One model does all of it: {site.model.name}.</h2>
          <div className="mt-10 grid gap-px bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
            {[
              [Layers, "Vision", "Reads up to 24 timestamped frames in one call and finds the moment the screen changed."],
              [Braces, "Long context", "Every log line in one report; small codebases go into the fix prompt whole."],
              [MousePointerClick, "Computer use", "Native tool calls drive your browser one step at a time. 61.7 on OSWorld-V2."],
              [ShieldCheck, "Coding and security", "73.7% on DeepSWE for fixes; 82% on CyberGym, and it flags leaked keys in traffic."],
            ].map(([Icon, title, body]) => {
              const I = Icon as typeof Layers;
              return (
                <div key={title as string} className="bg-media p-6">
                  <I className="size-6 text-[#fa8c16]" />
                  <h3 className="mt-4 text-subhead font-semibold">{title as string}</h3>
                  <p className="mt-2 text-ui text-white/65">{body as string}</p>
                </div>
              );
            })}
          </div>
          <p className="mt-4 text-caption text-white/45">Benchmark figures from MiniMax&apos;s launch post (October 19, 2026).</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild variant="ghost">
              <a href={site.model.url} target="_blank" rel="noreferrer">
                <Sparkles /> {site.model.name} on {site.provider.name}
              </a>
            </Button>
          </div>
        </div>
      </section>

      {/* Self-host */}
      <section className="py-16">
        <div className="container-page grid items-center gap-10 lg:grid-cols-2">
          <div>
            <p className="eyebrow">Open source · MIT</p>
            <h2 className="mt-2 text-display font-semibold">Runs on your machine in five minutes.</h2>
            <p className="mt-4 text-ink-2">
              One API key from {site.provider.name} is all it needs. It uses a SQLite file and keeps uploads on disk; the sandbox uses Docker when it&apos;s running. For a team, add a free Turso database and Cloudinary and deploy anywhere.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild>
                <Link href="/install">
                  <LayoutPanelLeft /> Install the extension
                </Link>
              </Button>
              <Button asChild variant="outline">
                <a href={site.repo} target="_blank" rel="noreferrer">
                  View on GitHub
                </a>
              </Button>
            </div>
          </div>
          <pre className="overflow-x-auto bg-footer p-6 font-mono text-[13px] leading-7 text-white/85">
            <span className="text-white/40"># the app</span>
            {"\n"}git clone {site.repo}.git && cd repro
            {"\n"}pnpm install && cp .env.example .env
            {"\n"}pnpm db:migrate && pnpm dev
            {"\n\n"}
            <span className="text-white/40"># the extension: load extension/release/repro-extension</span>
            {"\n"}
            <span className="text-white/40"># in chrome://extensions (Developer mode → Load unpacked)</span>
          </pre>
        </div>
      </section>
    </>
  );
}

function Tile({ eyebrow, title, body, children }: { eyebrow: string; title: string; body: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col bg-white p-8 sm:p-10">
      <p className="eyebrow">{eyebrow}</p>
      <h3 className="mt-2 text-title font-semibold">{title}</h3>
      <p className="mt-2 max-w-md text-ink-2">{body}</p>
      <div className="mt-auto pt-8">{children}</div>
    </div>
  );
}

function Row({ icon, t, text, tone }: { icon: React.ReactNode; t: string; text: string; tone?: "error" }) {
  return (
    <p className={`flex items-center gap-3 px-3 py-2 ${tone === "error" ? "bg-[#fff1f0] text-error" : "bg-fog"}`}>
      <span className="text-ink-3">{t}</span>
      <span className="text-ink-3">{icon}</span>
      <span className="truncate">{text}</span>
    </p>
  );
}
