import { NextRequest } from "next/server";
import { proxyAdmin } from "@/lib/admin-proxy";

type Params = { params: Promise<{ handle: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { handle } = await params;
  return proxyAdmin("GET", `/admin/users/${encodeURIComponent(handle)}/keys`);
}

export async function POST(request: NextRequest, { params }: Params) {
  const { handle } = await params;
  const body = await request.json().catch(() => ({}));
  return proxyAdmin("POST", `/admin/users/${encodeURIComponent(handle)}/keys`, body);
}
