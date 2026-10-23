import { Bug, PlugZap } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { timeAgo } from "@/lib/utils";
import type { Analysis } from "@/shared/schemas";
import { requireUser } from "@/server/auth";
import { listReports } from "@/server/services/reports";

export const metadata: Metadata = { title: "Reports" };

export default async function DashboardPage() {
  const user = await requireUser("/dashboard");
  const reports = await listReports(user.id);

  return (
    <div className="container-page py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Your workspace</p>
          <h1 className="mt-1 text-heading font-semibold">Bug reports</h1>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/connect">
            <PlugZap /> Connect the extension
          </Link>
        </Button>
      </div>

      {reports.length === 0 ? (
        <div className="mt-10 grid place-items-center bg-canvas-soft px-6 py-20 text-center">
          <Bug className="size-10 text-ink-3" />
          <h2 className="mt-4 text-title font-semibold">No reports yet</h2>
          <p className="mt-2 max-w-md text-ink-2">Install the extension, connect it to this account, then press Record on any page when something breaks.</p>
          <div className="mt-6 flex gap-2">
            <Button asChild>
              <Link href="/install">Install the extension</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/connect">Connect it</Link>
            </Button>
          </div>
        </div>
      ) : (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {reports.map((r) => {
            const a = r.analysis as Analysis | null;
            const frame = r.frames.at(-1)?.url;
            let host = r.pageUrl;
            try {
              host = new URL(r.pageUrl).host;
            } catch {}
            return (
              <li key={r.id}>
                <Link href={`/r/${r.id}`} className="group block bg-fog">
                  <div className="aspect-[16/10] overflow-hidden bg-media">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {frame && <img src={frame} alt="" className="size-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.03]" loading="lazy" />}
                  </div>
                  <div className="p-5">
                    <div className="flex items-center gap-2">
                      {a ? <Badge tone={a.severity}>{a.severity}</Badge> : <Badge tone="info">{r.status === "failed" ? "no report" : "new"}</Badge>}
                      <span className="text-caption text-ink-3">
                        {host} · {timeAgo(r.createdAt)}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-body font-semibold group-hover:text-primary">{r.title}</p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
