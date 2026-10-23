import { readLocal } from "@/server/storage";

/** Serves local uploads. Keys are random, so a link works like an unlisted share link. */
export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const file = await readLocal((await params).key.join("/"));
  if (!file) return new Response("Not found", { status: 404 });
  // DOM snapshots and replay data are served as plain text so they can never render on this origin.
  const type = file.contentType.startsWith("image/") || file.contentType.startsWith("video/") ? file.contentType : "text/plain; charset=utf-8";
  return new Response(new Uint8Array(file.bytes), {
    headers: { "content-type": type, "cache-control": "private, max-age=31536000, immutable" },
  });
}
