import { cn } from "@/lib/utils";

const tones = {
  low: "bg-fog text-ink-2",
  medium: "bg-[#fff4e5] text-tier",
  high: "bg-[#fff1f0] text-error",
  critical: "bg-error text-white",
  ok: "bg-[#ecf8ef] text-ok",
  info: "bg-primary-tint text-primary-strong",
  neutral: "bg-fog text-ink-2",
} as const;

export function Badge({ tone = "neutral", className, children }: { tone?: keyof typeof tones; className?: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-caption font-semibold capitalize", tones[tone], className)}>{children}</span>;
}
