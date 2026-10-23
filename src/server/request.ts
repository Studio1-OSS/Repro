import "server-only";
import { env, features } from "@/env";
import type { NebiusConfig } from "./ai/nebius";
import { getSessionUser } from "./auth";
import { isUnmigratedError, UNMIGRATED_MESSAGE } from "./db";
import { AI_COSTS, creditsLeft, spendCredits, type AiAction } from "./rate-limit";
import { userFromBearer } from "./services/tokens";
import { createStorage } from "./storage";

export const apiError = (status: number, message: string, extra?: Record<string, unknown>) => Response.json({ error: message, ...extra }, { status });

export const appUrl = () => env.BETTER_AUTH_URL ?? "http://localhost:3000";

export const storage = () => createStorage(env.CLOUDINARY_URL, appUrl());

export const aiConfig = (): NebiusConfig => ({ apiKey: env.NEBIUS_API_KEY!, baseURL: env.NEBIUS_BASE_URL, model: env.NEBIUS_MODEL });

export type ApiUser = { id: string; name: string; email: string };

/** The caller: the extension (Bearer token) or a signed-in browser session. */
export async function apiUser(request: Request): Promise<ApiUser | null> {
  try {
    return (await userFromBearer(request)) ?? (await getSessionUser());
  } catch (e) {
    if (isUnmigratedError(e)) throw new Error(UNMIGRATED_MESSAGE);
    throw e;
  }
}

/** The AI feature flag and the daily credit allowance, checked after the request itself is validated. */
export async function spendAi(user: ApiUser, action: AiAction): Promise<Response | null> {
  if (!features.ai) return apiError(503, "AI isn't configured. Set NEBIUS_API_KEY.");
  const key = `user:${user.id}`;
  const limit = env.AI_CREDITS_PER_USER_PER_DAY;
  if (await spendCredits(key, AI_COSTS[action], limit)) return null;
  return apiError(429, `Out of AI credits for today (${await creditsLeft(key, limit)} left). Credits reset at midnight UTC.`);
}
