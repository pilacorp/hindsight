// @vitest-environment jsdom
import React, { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { auth, translate } = vi.hoisted(() => ({
  auth: { getUser: vi.fn(), verifyOtp: vi.fn(), updateUser: vi.fn() },
  translate: (key: string) => key,
}));
vi.mock("next-intl", () => ({ useTranslations: () => translate }));
vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));
vi.mock("@/components/language-switcher", () => ({ LanguageSwitcher: () => null }));
vi.mock("@/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => ({ auth }) }));

import { PasswordForm } from "@/components/password-form";

const user = { id: "invited-user", email: "invite@example.test" };

beforeEach(() => {
  window.history.replaceState(null, "", "/auth/set-password?token_hash=valid-token&type=invite");
  auth.getUser.mockResolvedValue({ data: { user }, error: null });
  auth.verifyOtp.mockResolvedValue({
    data: { user, session: { access_token: "session" } },
    error: null,
  });
  auth.updateUser.mockResolvedValue({ error: null });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

async function fillPasswords(current?: string, confirmation = "a-new-password") {
  await screen.findByLabelText("newPassword");
  if (current)
    fireEvent.change(screen.getByLabelText("currentPassword"), { target: { value: current } });
  fireEvent.change(screen.getByLabelText("newPassword"), { target: { value: "a-new-password" } });
  fireEvent.change(screen.getByLabelText("confirmPassword"), { target: { value: confirmation } });
}

function submit() {
  fireEvent.submit(screen.getByRole("button", { name: "save" }).closest("form")!);
}

describe("invitation and recovery password setup", () => {
  it("does not consume a token on load, strips it from the URL, and survives Strict Mode", async () => {
    render(
      <StrictMode>
        <PasswordForm mode="setup" />
      </StrictMode>
    );
    await screen.findByLabelText("newPassword");
    expect(window.location.search).toBe("");
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    await fillPasswords();
    submit();
    await screen.findByText("success");
    expect(auth.verifyOtp).toHaveBeenCalledExactlyOnceWith({
      token_hash: "valid-token",
      type: "invite",
    });
    expect(auth.updateUser).toHaveBeenCalledExactlyOnceWith({ password: "a-new-password" });
    expect((screen.getByRole("link", { name: "continue" }) as HTMLAnchorElement).pathname).toBe(
      "/dashboard"
    );
  });

  it("accepts recovery links through the same form", async () => {
    window.history.replaceState(
      null,
      "",
      "/auth/set-password?token_hash=recovery-token&type=recovery"
    );
    render(<PasswordForm mode="setup" />);
    await fillPasswords();
    submit();
    await screen.findByText("success");
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "recovery-token", type: "recovery" });
  });

  it.each(["/auth/set-password", "/auth/set-password?token_hash=token&type=signup"])(
    "rejects a missing or unsupported invitation grant: %s",
    async (path) => {
      window.history.replaceState(null, "", path);
      render(<PasswordForm mode="setup" />);
      expect((await screen.findByRole("alert")).textContent).toBe("invalidLink");
      expect(screen.queryByLabelText("newPassword")).toBeNull();
      expect(auth.verifyOtp).not.toHaveBeenCalled();
      expect(auth.updateUser).not.toHaveBeenCalled();
    }
  );

  it("rejects expired/used tokens without updating the currently signed-in account", async () => {
    auth.verifyOtp.mockResolvedValue({
      data: { user: null, session: null },
      error: new Error("expired"),
    });
    render(<PasswordForm mode="setup" />);
    await fillPasswords();
    submit();
    expect((await screen.findByRole("alert")).textContent).toBe("invalidLink");
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("allows retry after an update failure without consuming the invitation twice", async () => {
    auth.updateUser.mockResolvedValueOnce({ error: new Error("Try a stronger password") });
    render(<PasswordForm mode="setup" />);
    await fillPasswords();
    submit();
    await screen.findByText("Try a stronger password");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "save" }).hasAttribute("disabled")).toBe(false)
    );
    submit();
    await screen.findByText("success");
    expect(auth.verifyOtp).toHaveBeenCalledTimes(1);
    expect(auth.updateUser).toHaveBeenCalledTimes(2);
  });

  it("rejects mismatched passwords before consuming the invitation", async () => {
    render(<PasswordForm mode="setup" />);
    await fillPasswords(undefined, "a-different-password");
    submit();
    expect((await screen.findByRole("alert")).textContent).toBe("mismatch");
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("lets the user retry a temporary Auth service failure", async () => {
    auth.verifyOtp.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: Object.assign(new Error("Service unavailable"), { status: 503 }),
    });
    render(<PasswordForm mode="setup" />);
    await fillPasswords();
    submit();
    await screen.findByText("connectionError");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "save" }).hasAttribute("disabled")).toBe(false)
    );
    submit();
    await screen.findByText("success");
    expect(auth.verifyOtp).toHaveBeenCalledTimes(2);
  });

  it("does not verify the invitation twice while a submission is in flight", async () => {
    let finish!: (value: {
      data: { user: typeof user; session: { access_token: string } };
      error: null;
    }) => void;
    auth.verifyOtp.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    render(<PasswordForm mode="setup" />);
    await fillPasswords();
    const form = screen.getByRole("button", { name: "save" }).closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(auth.verifyOtp).toHaveBeenCalledTimes(1);
    finish({ data: { user, session: { access_token: "session" } }, error: null });
    await screen.findByText("success");
    expect(auth.updateUser).toHaveBeenCalledTimes(1);
  });
});

describe("authenticated password changes", () => {
  it("uses the current user's session and passes the current password to Supabase", async () => {
    render(<PasswordForm mode="change" />);
    await fillPasswords("old-password");
    submit();
    await screen.findByText("success");
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(auth.updateUser).toHaveBeenCalledWith({
      password: "a-new-password",
      current_password: "old-password",
    });
  });

  it("requires sign-in and preserves a safe base-prefixed return URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/memory");
    auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    render(<PasswordForm mode="change" />);
    expect((await screen.findByRole("alert")).textContent).toBe("signInRequired");
    expect(screen.queryByLabelText("newPassword")).toBeNull();
    expect(screen.getByRole("link", { name: "signIn" }).getAttribute("href")).toBe(
      "/memory/login?returnTo=%2Faccount%2Fchange-password"
    );
  });

  it("refuses to change a different account when another tab switches sessions", async () => {
    auth.getUser.mockResolvedValueOnce({ data: { user }, error: null });
    render(<PasswordForm mode="change" />);
    await fillPasswords("old-password");
    auth.getUser.mockResolvedValue({ data: { user: { id: "different-user" } }, error: null });
    submit();
    expect((await screen.findByRole("alert")).textContent).toBe("signInRequired");
    expect(auth.updateUser).not.toHaveBeenCalled();
  });

  it("shows password-policy/current-password errors without claiming success", async () => {
    auth.updateUser.mockResolvedValue({ error: new Error("Current password required") });
    render(<PasswordForm mode="change" />);
    await fillPasswords("wrong-password");
    submit();
    await screen.findByText("Current password required");
    expect(screen.queryByText("success")).toBeNull();
  });
});
