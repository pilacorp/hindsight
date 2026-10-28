import { describe, expect, it } from "vitest";

import { apiAuthDecision } from "@/lib/public-api";

describe("public usage API", () => {
  it("allows /api/usage/team without a session and still rejects /api/banks", () => {
    expect(apiAuthDecision("/api/usage/team", null)).toBe("allow");
    expect(apiAuthDecision("/api/banks", null)).toBe("unauthorized");
    expect(apiAuthDecision("/api/banks", "Bearer token")).toBe("allow");
  });
});
