import { NextRequest } from "next/server";
import { proxyAdmin } from "@/lib/admin-proxy";

type Params = { params: Promise<{ handle: string }> };

export async function GET(_request: NextRequest, { params }: Params) {
  const { handle } = await params;
  return proxyAdmin("GET", `/admin/users/${encodeURIComponent(handle)}`);
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { handle } = await params;
  const body = await request.json().catch(() => ({}));
  return proxyAdmin("PATCH", `/admin/users/${encodeURIComponent(handle)}`, body);
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { handle } = await params;
  return proxyAdmin("DELETE", `/admin/users/${encodeURIComponent(handle)}`);
}
