import { cn } from "@/lib/utils";

/** A unified diff, file by file, with added and removed lines coloured. */
export function DiffView({ diff }: { diff: string }) {
  const files = diff.split(/^={10,}\n/m).filter((f) => f.trim());
  return (
    <div className="grid gap-3">
      {files.map((f, i) => {
        const lines = f.split("\n");
        const name = lines.find((l) => l.startsWith("+++ "))?.replace(/^\+\+\+ b\//, "") ?? `file ${i + 1}`;
        return (
          <div key={i} className="overflow-hidden border border-divider">
            <p className="border-b border-divider bg-canvas-soft px-3 py-2 font-mono text-caption font-semibold">{name}</p>
            <pre className="max-h-80 overflow-auto py-1 font-mono text-[12px] leading-5">
              {lines
                .filter((l) => !l.startsWith("--- ") && !l.startsWith("+++ ") && !l.startsWith("Index:"))
                .map((l, k) => (
                  <div
                    key={k}
                    className={cn(
                      "whitespace-pre-wrap break-all px-3",
                      l.startsWith("+") && "bg-[#ecf8ef] text-[#135200]",
                      l.startsWith("-") && "bg-[#fff1f0] text-[#a8071a]",
                      l.startsWith("@@") && "bg-primary-tint/50 text-primary-strong",
                    )}
                  >
                    {l || " "}
                  </div>
                ))}
            </pre>
          </div>
        );
      })}
    </div>
  );
}
