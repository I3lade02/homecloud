import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth-form";

import { getCurrentUser, getSetupStatus } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const setup = await getSetupStatus();

  if (setup.setupComplete) {
    const user = await getCurrentUser();

    redirect(user ? "/" : "/login");
  }

  return (
    <main className="auth-page">
      <section className={"auth-panel auth-panel--wide"}>
        <p className="eyebrow">První spuštění</p>

        <h1>Probuď svůj PiCloud.</h1>

        <p className="auth-lead">
          Tento účet dostane roli owner. Další uživatele budeme později vytvářet
          pouze z administrace.
        </p>

        <AuthForm mode="setup" />
      </section>
    </main>
  );
}
