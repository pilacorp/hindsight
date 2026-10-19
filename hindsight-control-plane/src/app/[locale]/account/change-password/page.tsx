import type { Metadata } from "next";
import { PasswordForm } from "@/components/password-form";

export const metadata: Metadata = {
  title: "Change password | Hindsight",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function ChangePasswordPage() {
  return <PasswordForm mode="change" />;
}
