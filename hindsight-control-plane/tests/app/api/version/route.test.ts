import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/version/route";

afterEach(() => vi.restoreAllMocks());

describe("GET /api/version (public, session-free)", () => {
  it("returns 200 and per_user_auth without a session", async () => {
    process.env.HINDSIGHT_CP_SESSION_SECRET = "x";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ version: "1.0.0", features: {} }), { status: 200 }))
    );
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe("1.0.0");
    expect(body.features.per_user_auth).toBe(true);
  });

  it("still returns 200 when the dataplane is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).features).toBeDefined();
  });
});
