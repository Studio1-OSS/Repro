import { getSessionUser } from "@/server/auth";
import { apiError, appUrl } from "@/server/request";
import { createExtensionToken } from "@/server/services/tokens";

/** Pairs the browser extension with the signed-in account (called from /connect). */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return apiError(401, "Sign in first");
  const body = (await request.json().catch(() => ({}))) as { label?: string };
  const token = await createExtensionToken(user.id, body.label || "Chrome extension");
  return Response.json({ token, appUrl: appUrl(), user: { name: user.name, email: user.email } });
}
