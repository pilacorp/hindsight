import { NextRequest } from "next/server";
import { proxyAdmin } from "@/lib/admin-proxy";

export async function GET() {
  return proxyAdmin("GET", "/admin/users");
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  return proxyAdmin("POST", "/admin/users", body);
}
