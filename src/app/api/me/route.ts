import { env } from "@/env";
import { creditsLeft } from "@/server/rate-limit";
import { apiError, apiUser, storage } from "@/server/request";

/** The extension's status check: who it's paired with and how much is left today. */
export async function GET(request: Request) {
  const user = await apiUser(request);
  if (!user) return apiError(401, "Not paired. Open Connect in Repro to pair this extension.");
  return Response.json({
    user: { name: user.name, email: user.email },
    storage: storage().kind,
    credits: { left: await creditsLeft(`user:${user.id}`, env.AI_CREDITS_PER_USER_PER_DAY), limit: env.AI_CREDITS_PER_USER_PER_DAY },
  });
}
