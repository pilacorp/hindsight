import { describe, expect, it } from "vitest";

import { isMemoryArea } from "@/components/memory-providers";

describe("memory provider scoping", () => {
  it("excludes login and admin (no memory fetch there)", () => {
    expect(isMemoryArea("/login")).toBe(false);
    expect(isMemoryArea("/login?returnTo=%2F")).toBe(false);
    expect(isMemoryArea("/admin")).toBe(false);
    expect(isMemoryArea("/admin/users/alice")).toBe(false);
  });

  it("includes the user memory area", () => {
    expect(isMemoryArea("/")).toBe(true);
    expect(isMemoryArea("/dashboard")).toBe(true);
    expect(isMemoryArea("/banks/personal")).toBe(true);
    // not fooled by a prefix match like /administration (not /admin segment)
    expect(isMemoryArea("/administration")).toBe(true);
  });
});
