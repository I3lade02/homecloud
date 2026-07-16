import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth-form";

import { getCurrentUser, getSetupStatus } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const setup = await getSetupStatus();

  if (!setup.setupComplete) {
    redirect("/setup");
  }

  const user = await getCurrentUser();

  if (user) {
    redirect("/");
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <p className="eyebrow">PiCloud access</p>

        <h1>Vítej zpátky.</h1>

        <p className="auth-lead">
          Přihlas se ke svému soukromému cloudu. Session zůstane uložená v
          HttpOnly cookie.
        </p>

        <AuthForm mode="login" />
      </section>
    </main>
  );
}
