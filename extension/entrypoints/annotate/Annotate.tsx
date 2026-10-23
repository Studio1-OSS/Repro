// Mark up a screenshot before it's uploaded: boxes, arrows, text, and blur for anything private.
import { useEffect, useRef, useState } from "react";

type Tool = "box" | "arrow" | "blur" | "text";
type Shape = { tool: Tool; x1: number; y1: number; x2: number; y2: number; text?: string };
export type PendingShot = { shot: string; note?: string };

const RED = "#f5222d";

function draw(ctx: CanvasRenderingContext2D, img: HTMLImageElement, shapes: Shape[]) {
  ctx.drawImage(img, 0, 0);
  const s = img.naturalWidth / 1280; // line widths scale with the screenshot
  for (const sh of shapes) {
    const x = Math.min(sh.x1, sh.x2), y = Math.min(sh.y1, sh.y2), w = Math.abs(sh.x2 - sh.x1), h = Math.abs(sh.y2 - sh.y1);
    if (sh.tool === "blur" && w > 2 && h > 2) {
      // Pixelate: shrink the region hard, then scale it back up without smoothing.
      const block = Math.max(8, Math.round(14 * s));
      const tmp = document.createElement("canvas");
      tmp.width = Math.max(1, Math.round(w / block));
      tmp.height = Math.max(1, Math.round(h / block));
      tmp.getContext("2d")!.drawImage(ctx.canvas, x, y, w, h, 0, 0, tmp.width, tmp.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, x, y, w, h);
      ctx.imageSmoothingEnabled = true;
    } else if (sh.tool === "box") {
      ctx.strokeStyle = RED;
      ctx.lineWidth = 4 * s;
      ctx.strokeRect(x, y, w, h);
    } else if (sh.tool === "arrow") {
      const angle = Math.atan2(sh.y2 - sh.y1, sh.x2 - sh.x1);
      const head = 22 * s;
      ctx.strokeStyle = ctx.fillStyle = RED;
      ctx.lineWidth = 5 * s;
      ctx.beginPath();
      ctx.moveTo(sh.x1, sh.y1);
      ctx.lineTo(sh.x2, sh.y2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(sh.x2, sh.y2);
      ctx.lineTo(sh.x2 - head * Math.cos(angle - 0.45), sh.y2 - head * Math.sin(angle - 0.45));
      ctx.lineTo(sh.x2 - head * Math.cos(angle + 0.45), sh.y2 - head * Math.sin(angle + 0.45));
      ctx.closePath();
      ctx.fill();
    } else if (sh.tool === "text" && sh.text) {
      const size = Math.round(26 * s);
      ctx.font = `600 ${size}px system-ui, sans-serif`;
      const pad = 8 * s;
      const width = ctx.measureText(sh.text).width;
      ctx.fillStyle = RED;
      ctx.fillRect(sh.x1, sh.y1 - size - pad, width + pad * 2, size + pad * 2);
      ctx.fillStyle = "#fff";
      ctx.fillText(sh.text, sh.x1 + pad, sh.y1 - pad / 2);
    }
  }
}

export function Annotate() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const img = useRef<HTMLImageElement | null>(null);
  const [pending, setPending] = useState<PendingShot | null>(null);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [drag, setDrag] = useState<Shape | null>(null);
  const [tool, setTool] = useState<Tool>("box");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    chrome.storage.session.get("pendingShot").then(({ pendingShot }) => {
      const p = pendingShot as PendingShot | undefined;
      if (!p) return;
      setPending(p);
      setNote(p.note ?? "");
      const i = new Image();
      i.onload = () => {
        img.current = i;
        canvas.current!.width = i.naturalWidth;
        canvas.current!.height = i.naturalHeight;
        draw(canvas.current!.getContext("2d")!, i, []);
      };
      i.src = p.shot;
    });
  }, []);

  useEffect(() => {
    if (img.current && canvas.current) draw(canvas.current.getContext("2d")!, img.current, drag ? [...shapes, drag] : shapes);
  }, [shapes, drag]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const k = e.currentTarget.width / r.width;
    return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k };
  };

  async function finish(annotated: boolean) {
    setSending(true);
    const shot = annotated && shapes.length ? canvas.current!.toDataURL("image/jpeg", 0.85) : pending!.shot;
    await chrome.runtime.sendMessage({ type: "repro:screenshot-finish", shot, note: note.trim() || undefined });
    window.close();
  }

  if (!pending) return <p style={{ padding: 24, fontFamily: "system-ui" }}>No screenshot waiting. Take one from the Repro popup.</p>;

  return (
    <div className="flex h-screen flex-col bg-[#f5f5f5]">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-white px-4 py-3">
        <span className="mr-2 text-[15px] font-semibold tracking-[-0.03em]">Mark up the screenshot</span>
        {(["box", "arrow", "text", "blur"] as Tool[]).map((t) => (
          <button key={t} onClick={() => setTool(t)} className={`h-8 rounded-full px-3 text-xs capitalize ${tool === t ? "bg-ink text-white" : "bg-fog text-ink-2"}`}>
            {t === "blur" ? "Blur private info" : t}
          </button>
        ))}
        <button onClick={() => setShapes((s) => s.slice(0, -1))} disabled={!shapes.length} className="h-8 rounded-full px-3 text-xs text-ink-2 disabled:opacity-30">
          Undo
        </button>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What went wrong?" className="ml-auto h-9 w-72 border border-line px-3 text-sm outline-none focus:border-primary" />
        <button onClick={() => finish(false)} disabled={sending} className="h-9 rounded-full border border-ink px-4 text-sm">
          Skip
        </button>
        <button onClick={() => finish(true)} disabled={sending} className="h-9 rounded-full bg-primary px-4 text-sm text-white">
          {sending ? "Creating…" : "Create report"}
        </button>
      </div>
      <div className="flex-1 overflow-auto p-6">
        <canvas
          ref={canvas}
          className="mx-auto block max-w-full cursor-crosshair bg-white shadow-[0_8px_16px_rgba(0,0,0,.1)]"
          onPointerDown={(e) => {
            const p = point(e);
            if (tool === "text") {
              const text = prompt("Label");
              if (text) setShapes((s) => [...s, { tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, text }]);
              return;
            }
            e.currentTarget.setPointerCapture(e.pointerId);
            setDrag({ tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y });
          }}
          onPointerMove={(e) => drag && setDrag({ ...drag, ...((p) => ({ x2: p.x, y2: p.y }))(point(e)) })}
          onPointerUp={() => {
            if (drag && (Math.abs(drag.x2 - drag.x1) > 4 || Math.abs(drag.y2 - drag.y1) > 4)) setShapes((s) => [...s, drag]);
            setDrag(null);
          }}
        />
      </div>
    </div>
  );
}
