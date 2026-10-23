import Link from "next/link";
import { cn } from "@/lib/utils";

/** The mark: a cursor inside a replay loop, on the action blue: Repro replays your clicks. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-7", className)}>
      <rect x="1" y="1" width="30" height="30" rx="8" fill="#0070d5" />
      <path d="M23.9 10.6A9.2 9.2 0 1 0 25.2 16" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" />
      <path d="M25.3 6.4v4.9h-4.9" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.2 10.4v10.8l2.7-2.5 1.9 4 1.9-.9-1.9-3.9h3.7z" fill="#fff" />
    </svg>
  );
}

export function Logo({ className, href = "/" }: { className?: string; href?: string }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2 text-[19px] font-semibold tracking-[-0.03em] text-ink", className)}>
      <LogoMark />
      Repro
    </Link>
  );
}
