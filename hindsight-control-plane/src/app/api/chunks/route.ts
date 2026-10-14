import { NextRequest } from "next/server";
import { missingQueryParam } from "@/lib/i18n/api-errors";
import { sdk, getClient } from "@/lib/hindsight-client";
import { respondWithSdk } from "@/lib/sdk-response";

export async function GET(request: NextRequest) {
  const chunkId = request.nextUrl.searchParams.get("chunk_id");
  if (!chunkId) return missingQueryParam(request, "chunk_id");

  const response = await sdk.getChunk({
    client: (await getClient()),
    path: { chunk_id: chunkId },
  });
  return respondWithSdk(response, "Failed to fetch chunk", { request });
}
