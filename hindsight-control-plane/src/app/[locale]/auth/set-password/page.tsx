import type { Metadata } from "next";
import { PasswordForm } from "@/components/password-form";

export const metadata: Metadata = {
  title: "Set password | Hindsight",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function SetPasswordPage() {
  return <PasswordForm mode="setup" />;
}
