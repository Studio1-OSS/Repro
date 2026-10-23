import { CheckCircle2, Globe, MousePointerClick, ShieldAlert, Sparkles } from "lucide-react";
import Image from "next/image";

/**
 * The hero's product shot, built from real parts: saucedemo's open-source store at the moment of the bug,
 * the report card, the timeline and the agent's step feed, laid out like the app shows them.
 */
export function HeroShowcase() {
  return (
    <div className="relative mx-auto mt-14 max-w-[1080px]">
      {/* Browser window with the recording */}
      <div className="overflow-hidden border border-white/10 bg-[#161616] shadow-[0_40px_120px_rgba(0,0,0,0.55)]">
        <div className="flex h-9 items-center gap-2 border-b border-white/10 px-3">
          <span className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-[#ff5f57]" />
            <span className="size-2.5 rounded-full bg-[#febc2e]" />
            <span className="size-2.5 rounded-full bg-[#28c840]" />
          </span>
          <span className="ml-3 flex h-6 flex-1 items-center gap-1.5 rounded-full bg-white/5 px-3 text-[11px] text-white/50">
            <Globe className="size-3" /> localhost:4500/inventory.html
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f5222d] px-2.5 py-0.5 text-[11px] font-semibold text-white">
            <span className="size-1.5 animate-pulse rounded-full bg-white" /> REC 0:04
          </span>
        </div>
        <Image src="/landing/hero-app.png" alt="Swag Labs, saucedemo's open-source store, where sorting by price does nothing" width={1440} height={900} priority className="block h-auto w-full" />
        {/* Timeline */}
        <div className="border-t border-white/10 px-4 py-3">
          <div className="relative h-5">
            <div className="absolute inset-x-0 top-1/2 h-px bg-white/15" />
            {[8, 34, 61].map((x, i) => (
              <span key={x} className="absolute top-1/2 grid size-4 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-primary text-[9px] font-semibold text-white" style={{ left: `${x}%` }}>
                {i + 1}
              </span>
            ))}
            <span className="absolute top-1/2 h-4 w-[3px] -translate-y-1/2 bg-[#f5222d]" style={{ left: "63%" }} />
            <span className="absolute inset-y-0 w-0.5 bg-white" style={{ left: "70%" }} />
          </div>
        </div>
      </div>

      {/* AI report card */}
      <div className="absolute -right-4 top-16 hidden w-[340px] bg-white p-5 text-left text-ink shadow-float lg:block xl:-right-16">
        <p className="eyebrow flex items-center gap-1.5">
          <Sparkles className="size-3.5" /> AI report
        </p>
        <p className="mt-2 text-[17px] font-semibold leading-snug tracking-[-0.03em]">Sorting by price doesn&apos;t reorder the products</p>
        <ol className="mt-3 grid gap-1.5 text-[13px]">
          {["Sign in as problem_user", 'Choose "Price (low to high)"', "The order doesn't change"].map((s, i) => (
            <li key={s} className="flex items-center gap-2">
              <span className="grid size-5 place-items-center rounded-full bg-primary text-[10px] font-semibold text-white">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-[12px] font-semibold text-ink-2">Likely cause</p>
        <p className="mt-0.5 text-[13px] leading-snug">
          <code className="bg-fog px-1">sortByOption</code> returns early for this account, so the list never re-sorts.
        </p>
        <p className="mt-3 flex items-start gap-1.5 bg-[#ecf8ef] px-2.5 py-2 text-[12px] leading-snug">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-ok" /> Fix verified in the sandbox
        </p>
      </div>

      {/* Agent feed */}
      <div className="absolute -left-4 bottom-10 hidden w-[300px] bg-white p-4 text-left text-ink shadow-float lg:block xl:-left-16">
        <p className="eyebrow">Reproducing in your browser</p>
        <ul className="mt-2 grid gap-2 text-[13px]">
          <li className="flex items-center gap-2"><MousePointerClick className="size-3.5 text-ink-3" /> Choose “Price (low to high)”</li>
          <li className="flex items-center gap-2"><MousePointerClick className="size-3.5 text-ink-3" /> Compare the first prices</li>
          <li className="flex items-center gap-2 font-semibold text-ok"><CheckCircle2 className="size-4" /> Reproduced in 3 steps</li>
        </ul>
      </div>
    </div>
  );
}
