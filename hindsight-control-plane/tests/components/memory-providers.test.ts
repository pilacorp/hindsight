import { describe, expect, it } from "vitest";

import { isMemoryArea } from "@/components/memory-providers";

describe("memory provider scoping", () => {
  it("excludes the login page (no session yet, no memory fetch there)", () => {
    expect(isMemoryArea("/login")).toBe(false);
    expect(isMemoryArea("/login?returnTo=%2F")).toBe(false);
  });

  it("includes the user memory area", () => {
    expect(isMemoryArea("/")).toBe(true);
    expect(isMemoryArea("/dashboard")).toBe(true);
    expect(isMemoryArea("/banks/personal")).toBe(true);
  });
});
