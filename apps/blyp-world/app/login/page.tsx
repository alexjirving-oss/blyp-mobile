import type { Metadata } from "next";
import { SurfaceShell } from "@/components/SurfaceShell";
import { LoginForm } from "@/components/LoginForm";

export const metadata: Metadata = {
  title: "Log in",
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <SurfaceShell eyebrow="Account" title="Log in">
      <LoginForm />
    </SurfaceShell>
  );
}
