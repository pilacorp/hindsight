import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/usage/team/route";

afterEach(() => vi.restoreAllMocks());

describe("GET /api/usage/team", () => {
  it("proxies without an Authorization header", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ members: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(new Request("http://localhost/api/usage/team?range=7d"));
    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit | undefined];
    expect(url).toContain("/v1/default/usage/team?range=7d");
    expect(init?.headers).toBeUndefined();
  });

  it("returns the dataplane status and does not invent members on failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 503 })));
    const response = await GET(new Request("http://localhost/api/usage/team"));
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("nope");
  });
});
