import { NextRequest } from "next/server";
import { proxyAdmin } from "@/lib/admin-proxy";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ handle: string }> }
) {
  const { handle } = await params;
  return proxyAdmin("POST", `/admin/users/${encodeURIComponent(handle)}/disable`);
}
