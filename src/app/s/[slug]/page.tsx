import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReportView } from "@/components/report/report-view";
import { SiteFooter } from "@/components/site-chrome";
import { Logo } from "@/components/logo";
import { appUrl } from "@/server/request";
import { getSharedReport, toReportData } from "@/server/services/reports";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const report = await getSharedReport((await params).slug);
  return { title: report?.title ?? "Shared report", robots: { index: false } };
}

/** A shared report: read-only, no account needed. */
export default async function SharedReportPage({ params }: Props) {
  const report = await getSharedReport((await params).slug);
  if (!report) notFound();
  return (
    <>
      <header className="border-b border-hairline">
        <div className="container-page flex h-16 items-center justify-between">
          <Logo />
          <Link href="/" className="text-ui text-primary hover:underline">
            Record your own bugs with Repro ›
          </Link>
        </div>
      </header>
      <ReportView report={toReportData(report)} appUrl={appUrl()} readOnly />
      <SiteFooter />
    </>
  );
}
