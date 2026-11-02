import { describe, expect, it } from "vitest";

import { bankChoiceUrl, loopbackRedirect, validBankId } from "@/lib/harness-bank";

describe("harness bank redirect", () => {
  it("keeps an http loopback redirect and refuses an external one", () => {
    const local = loopbackRedirect("http://127.0.0.1:43123/callback?state=kept");
    expect(local?.hostname).toBe("127.0.0.1");
    expect(local?.port).toBe("43123");
    expect(loopbackRedirect("http://localhost:9/callback")).not.toBeNull();

    expect(loopbackRedirect("https://evil.example/callback")).toBeNull();
    expect(loopbackRedirect("http://evil.example:9/callback")).toBeNull();
    expect(loopbackRedirect("http://user:secret@127.0.0.1:9/callback")).toBeNull();
    expect(loopbackRedirect("http://127.0.0.1/callback")).toBeNull();
    expect(loopbackRedirect(null)).toBeNull();
  });

  it("adds the chosen bank id and state to the loopback URL", () => {
    const redirect = loopbackRedirect("http://127.0.0.1:9/callback");
    expect(redirect).not.toBeNull();
    expect(bankChoiceUrl(redirect as URL, "chosen-bank", "state-1")).toBe(
      "http://127.0.0.1:9/callback?bank_id=chosen-bank&state=state-1"
    );
    expect(validBankId("chosen-bank")).toBe(true);
    expect(validBankId("../etc")).toBe(false);
  });
});
