"use client";

import { useState, type FormEvent } from "react";

interface ApiError {
  message?: string;
}

export function AuthForm({ mode }: { mode: "login" | "setup" }) {
  const [error, setError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);

  const isSetup = mode === "setup";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError(null);

    setSubmitting(true);

    const formData = new FormData(event.currentTarget);

    const payload = isSetup
      ? {
          displayName: String(formData.get("displayName") ?? ""),

          email: String(formData.get("email") ?? ""),

          password: String(formData.get("password") ?? ""),

          passwordConfirmation: String(
            formData.get("passwordConfirmation") ?? "",
          ),
        }
      : {
          email: String(formData.get("email") ?? ""),

          password: String(formData.get("password") ?? ""),
        };

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

      const path = isSetup ? "/setup/owner" : "/auth/login";

      const response = await fetch(
        `${apiUrl}${path}`,

        {
          method: "POST",

          credentials: "include",

          headers: {
            "content-type": "application/json",
          },

          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ApiError;

        setError(body.message ?? "Požadavek se nepodařilo dokončit.");

        return;
      }

      window.location.assign("/");
    } catch {
      setError("API není dostupné. Zkontroluj běh Docker kontejnerů.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      {isSetup ? (
        <label>
          <span>Zobrazované jméno</span>

          <input
            name="displayName"
            type="text"
            autoComplete="name"
            minLength={2}
            maxLength={80}
            required
            autoFocus
          />
        </label>
      ) : null}

      <label>
        <span>E-mail</span>

        <input
          name="email"
          type="email"
          autoComplete="email"
          maxLength={320}
          required
          autoFocus={!isSetup}
        />
      </label>

      <label>
        <span>Heslo</span>

        <input
          name="password"
          type="password"

          autoComplete={isSetup ? "new-password" : "current-password"}

          minLength={isSetup ? 12 : 1}

          maxLength={256}

          required
        />
      </label>

      {isSetup ? (
        <label>
          <span>Heslo znovu</span>

          <input
            name={"passwordConfirmation"}

            type="password"

            autoComplete={"new-password"}

            minLength={12}

            maxLength={256}

            required
          />
        </label>
      ) : null}

      {error ? <p className="auth-error">{error}</p> : null}

      <button
        className={"button button--primary auth-submit"}

        disabled={submitting}
      >
        {submitting
          ? "Pracuji…"
          : isSetup
            ? "Vytvořit owner účet"
            : "Přihlásit se"}
      </button>
    </form>
  );
}
