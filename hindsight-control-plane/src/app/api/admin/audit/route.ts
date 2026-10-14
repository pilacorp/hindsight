import { proxyAdmin } from "@/lib/admin-proxy";

export async function GET() {
  return proxyAdmin("GET", "/admin/audit");
}
