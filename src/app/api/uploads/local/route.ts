import { apiError, apiUser, storage } from "@/server/request";
import { saveLocal } from "@/server/storage";

const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "video/webm", "video/mp4", "application/json", "text/html"]);
const MAX_BYTES = 100 * 1024 * 1024;

/** Local-disk uploads, used only when CLOUDINARY_URL isn't set. */
export async function POST(request: Request) {
  if (storage().kind !== "local") return apiError(404, "Uploads go to Cloudinary");
  if (!(await apiUser(request))) return apiError(401, "Not signed in");
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return apiError(400, "Attach a file");
  const type = file.type.split(";")[0];
  if (!TYPES.has(type)) return apiError(415, "Only images, WebM/MP4 video, JSON or HTML");
  if (file.size === 0 || file.size > MAX_BYTES) return apiError(413, "The file is empty or over 100 MB");
  const url = await saveLocal(Buffer.from(await file.arrayBuffer()), type);
  return Response.json({ url });
}
