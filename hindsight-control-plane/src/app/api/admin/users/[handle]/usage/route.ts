import { NextRequest } from "next/server";
import { proxyAdmin } from "@/lib/admin-proxy";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ handle: string }> }
) {
  const { handle } = await params;
  return proxyAdmin("GET", `/admin/users/${encodeURIComponent(handle)}/usage`);
}
