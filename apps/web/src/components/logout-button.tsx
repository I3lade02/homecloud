"use client";

import { useState } from "react";

export function LogoutButton() {
  const [submitting, setSubmitting] = useState(false);

  async function logout() {
    setSubmitting(true);

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

      await fetch(
        `${apiUrl}/auth/logout`,

        {
          method: "POST",

          credentials: "include",
        },
      );
    } finally {
      window.location.assign("/login");
    }
  }

  return (
    <button
      className={"button button--secondary"}

      type="button"

      disabled={submitting}

      onClick={logout}
    >
      {submitting ? "Odhlašuji…" : "Odhlásit"}
    </button>
  );
}
