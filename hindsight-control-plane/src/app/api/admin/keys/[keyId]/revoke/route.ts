import { NextRequest } from "next/server";
import { proxyAdmin } from "@/lib/admin-proxy";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ keyId: string }> }) {
  const { keyId } = await params;
  return proxyAdmin("POST", `/admin/keys/${encodeURIComponent(keyId)}/revoke`);
}
