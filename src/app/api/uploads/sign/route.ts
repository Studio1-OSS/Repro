import { apiError, apiUser, storage } from "@/server/request";

/** Where to upload one file: a signed Cloudinary request, or this server's local endpoint. */
export async function POST(request: Request) {
  if (!(await apiUser(request))) return apiError(401, "Not signed in");
  return Response.json(storage().uploadTarget());
}
