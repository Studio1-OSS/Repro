import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { site } from "@/config/site";
import type { SessionUser } from "@/server/auth";
import { SignOutButton } from "./sign-out-button";

export function AnnouncementBar() {
  return (
    <div className="bg-announce text-center text-ui text-ink">
      <div className="container-page flex h-10 items-center justify-center gap-1.5">
        <span>Open source, powered by {site.model.name} on {site.provider.name}.</span>
        <a href={site.model.url} target="_blank" rel="noreferrer" className="hidden text-primary hover:underline sm:inline">
          About the model ›
        </a>
      </div>
    </div>
  );
}

export function SiteHeader({ user }: { user: SessionUser | null }) {
  return (
    <header className="sticky top-0 z-40 border-b border-hairline bg-canvas/95 backdrop-blur">
      <div className="container-page flex h-16 items-center gap-6">
        <Logo href={user ? "/dashboard" : "/"} />
        <nav className="hidden items-center gap-6 text-ui text-ink md:flex">
          {user ? (
            <>
              <Link href="/dashboard" className="hover:text-primary">Reports</Link>
              <Link href="/projects" className="hover:text-primary">Projects</Link>
              <Link href="/connect" className="hover:text-primary">Extension</Link>
            </>
          ) : (
            <>
              <Link href="/#how" className="hover:text-primary">How it works</Link>
              <Link href="/#bench" className="hover:text-primary">Benchmark</Link>
              <Link href="/install" className="hover:text-primary">Install</Link>
            </>
          )}
          <a href={site.repo} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-primary">
            GitHub <ArrowUpRight className="size-3.5" />
          </a>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <>
              <span className="hidden text-ui text-ink-2 sm:inline">{user.email}</span>
              <SignOutButton />
            </>
          ) : (
            <>
              <Button asChild variant="quiet" size="sm">
                <Link href="/sign-in">Sign in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/install">Install the extension</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="bg-footer text-footer-link">
      <div className="container-page grid gap-10 py-12 text-ui sm:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <p className="text-subhead font-semibold text-white">Repro</p>
          <p className="mt-2 max-w-xs">Open-source bug capture with an AI that writes the report and reproduces it in your own browser.</p>
        </div>
        <div className="grid content-start gap-2">
          <p className="text-caption font-medium text-white">Product</p>
          <Link href="/install" className="hover:text-white">Install the extension</Link>
          <Link href="/dashboard" className="hover:text-white">Your reports</Link>
          <Link href="/#bench" className="hover:text-white">Benchmark</Link>
        </div>
        <div className="grid content-start gap-2">
          <p className="text-caption font-medium text-white">Built with</p>
          <a href={site.model.url} target="_blank" rel="noreferrer" className="hover:text-white">{site.model.name}</a>
          <a href={site.provider.url} target="_blank" rel="noreferrer" className="hover:text-white">{site.provider.name}</a>
          <a href={site.repo} target="_blank" rel="noreferrer" className="hover:text-white">Source on GitHub (MIT)</a>
        </div>
      </div>
      <div className="border-t border-[#414141]">
        <p className="container-page py-4 text-caption">Built by the Studio1 team.</p>
      </div>
    </footer>
  );
}
