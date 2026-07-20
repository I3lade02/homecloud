import { redirect } from "next/navigation";

import { LogoutButton } from "@/components/logout-button";

import { getCurrentUser, getHealth, getSetupStatus } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const setup = await getSetupStatus();

  if (!setup.setupComplete) {
    redirect("/setup");
  }

  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const health = await getHealth();

  const healthy = health?.status === "healthy";

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top">
          <span className="brand-mark" aria-hidden="true">
            ☁
          </span>

          <span>PiCloud</span>
        </a>

        <div className="topbar-user">
          <div>
            <strong>{user.displayName}</strong>

            <span>{user.role}</span>
          </div>

          <LogoutButton />
        </div>
      </header>

      <section
        className={"hero hero--dashboard"}

        id="top"
      >
        <div className="hero__copy">
          <p className="eyebrow">Milník 2 · autentizace</p>

          <h1>Vítej, {user.displayName}.</h1>

          <p className="hero__lead">
            Owner účet, databázové sessions a chráněný dashboard už běží.
            PiCloud nyní pozná, kdo stojí u dveří.
          </p>
        </div>

        <div className="hero__actions">
          <a
            className={
              "button button--primary"
            }
            href="/files"
          >
            Otevřít moje soubory
          </a>
        </div>

        <aside className="account-card">
          <p className="eyebrow">Aktivní účet</p>

          <strong>{user.email}</strong>

          <dl>
            <div>
              <dt>Role</dt>
              <dd>{user.role}</dd>
            </div>

            <div>
              <dt>Session</dt>
              <dd>HttpOnly cookie</dd>
            </div>

            <div>
              <dt>Poslední login</dt>

              <dd>
                {user.lastLoginAt
                  ? new Date(user.lastLoginAt).toLocaleString("cs-CZ")
                  : "První přihlášení"}
              </dd>
            </div>
          </dl>
        </aside>
      </section>

      <section className="summary-grid">
        <article className="summary-card">
          <span>Stav platformy</span>

          <strong>{healthy ? "Healthy" : "Degraded"}</strong>
        </article>

        <article className="summary-card">
          <span>Autentizace</span>

          <strong>Session cookie</strong>
        </article>

        <article className="summary-card">
          <span>Hesla</span>

          <strong>Argon2id</strong>
        </article>

        <article className="summary-card">
          <span>Databáze</span>

          <strong>Drizzle ORM</strong>
        </article>
      </section>

      <section className="next-step">
        <p className="eyebrow">Další milník</p>

        <h2>Složky, metadata a první souborový strom</h2>

        <p>
          Každá budoucí složka a každý soubor už může mít skutečného vlastníka.
        </p>
      </section>
    </main>
  );
}
