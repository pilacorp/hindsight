import { describe, expect, it } from "vitest";

import {
  SESSION_MAX_AGE_SECONDS,
  decryptSession,
  encryptSession,
} from "@/lib/auth/nda-session";

const SECRET = "a-strong-session-secret";

describe("nda-session", () => {
  it("round-trips a user session", async () => {
    const token = await encryptSession({ kind: "user", handle: "alice", apiKey: "ndak_a_b" }, SECRET);
    const data = await decryptSession(token, SECRET);
    expect(data).toMatchObject({ kind: "user", handle: "alice", apiKey: "ndak_a_b" });
    expect(typeof data?.iat).toBe("number");
  });

  it("does not expose the api key in the cookie value", async () => {
    const token = await encryptSession({ kind: "user", handle: "alice", apiKey: "ndak_secret_value" }, SECRET);
    expect(token).not.toContain("ndak_");
    expect(token).not.toContain("secret_value");
  });

  it("rejects a wrong secret", async () => {
    const token = await encryptSession({ kind: "admin", handle: null, apiKey: "ndak_x" }, SECRET);
    expect(await decryptSession(token, "other-secret")).toBeNull();
  });

  it("rejects a tampered token", async () => {
    const token = await encryptSession({ kind: "user", handle: "a", apiKey: "ndak_x" }, SECRET);
    expect(await decryptSession(token.slice(0, -2) + "zz", SECRET)).toBeNull();
  });

  it("rejects an expired session", async () => {
    const stale = Math.floor(Date.now() / 1000) - SESSION_MAX_AGE_SECONDS - 10;
    const token = await encryptSession({ kind: "user", handle: "a", apiKey: "ndak_x", iat: stale }, SECRET);
    expect(await decryptSession(token, SECRET)).toBeNull();
  });

  it("rejects garbage and empty input", async () => {
    expect(await decryptSession(undefined, SECRET)).toBeNull();
    expect(await decryptSession("not-base64url!!", SECRET)).toBeNull();
    expect(await decryptSession("", SECRET)).toBeNull();
  });
});
