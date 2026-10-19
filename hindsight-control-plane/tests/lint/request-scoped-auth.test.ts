import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const CODEMOD = fileURLToPath(new URL("../../scripts/nda-cp-codemod.mjs", import.meta.url));

describe("request-scoped dataplane auth", () => {
  it("has no API route importing a module-level dataplane client", () => {
    // The codemod --check is the gate: it exits non-zero if any route still
    // uses lowLevelClient / hindsightClient / a sync getDataplaneHeaders.
    expect(() => execFileSync("node", [CODEMOD, "--check"], { encoding: "utf8" })).not.toThrow();
  });

  it("the request-scoped accessors read the session, not a fixed env credential", () => {
    const src = readFileSync(fileURLToPath(new URL("../../src/lib/hindsight-client.ts", import.meta.url)), "utf8");
    expect(src).not.toContain("HINDSIGHT_CP_DATAPLANE_API_KEY");
    expect(src).toContain("getRequestToken");
  });
});
