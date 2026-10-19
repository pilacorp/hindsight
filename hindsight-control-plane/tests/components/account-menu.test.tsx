// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { auth, unsubscribe } = vi.hoisted(() => ({
  auth: { onAuthStateChange: vi.fn(), signOut: vi.fn() },
  unsubscribe: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({ getSupabaseBrowserClient: () => ({ auth }) }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

import { AccountMenu } from "@/components/account-menu";

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

function openMenu() {
  fireEvent.keyDown(screen.getByRole("button", { name: "title" }), { key: "Enter" });
}

describe("Account menu", () => {
  it("shows session identity, updates it on account changes, and unsubscribes on unmount", async () => {
    let onChange: (event: string, session: unknown) => void;
    auth.onAuthStateChange.mockImplementation((callback) => {
      onChange = callback;
      callback("INITIAL_SESSION", {
        user: { email: "first@example.test", user_metadata: { full_name: "First User" } },
      });
      return { data: { subscription: { unsubscribe } } };
    });
    const { unmount } = render(<AccountMenu />);
    openMenu();
    expect((await screen.findByText("First User")).textContent).toBe("First User");
    expect(screen.getByText("first@example.test")).toBeTruthy();
    act(() => onChange("SIGNED_IN", { user: { email: "second@example.test", user_metadata: {} } }));
    expect(screen.getByText("second@example.test")).toBeTruthy();
    expect(screen.queryByText("First User")).toBeNull();
    act(() => onChange("SIGNED_OUT", null));
    expect(screen.queryByText("second@example.test")).toBeNull();
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("provides password navigation with the configured base path and a logout action", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/hindsight");
    auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe } } });
    render(<AccountMenu />);
    openMenu();
    const link = await screen.findByRole("menuitem", { name: "changeTitle" });
    expect(link.getAttribute("href")).toBe("/hindsight/account/change-password");
    expect(screen.getByRole("menuitem", { name: "logout" })).toBeTruthy();
  });
});
