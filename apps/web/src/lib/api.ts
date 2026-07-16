import { headers } from "next/headers";

import type {
  AuthUser,
  AuthUserResponse,
  PiCloudHealth,
  SetupStatusResponse,
} from "@picloud/contracts";

function getInternalApiUrl(): string {
  return process.env.API_INTERNAL_URL ?? "http://localhost:4000";
}

async function apiFetch(path: string, init: RequestInit = {}) {
  const incomingHeaders = await headers();

  const requestHeaders = new Headers(init.headers);

  const cookie = incomingHeaders.get("cookie");

  if (cookie) {
    requestHeaders.set("cookie", cookie);
  }

  return fetch(
    `${getInternalApiUrl()}${path}`,

    {
      ...init,

      headers: requestHeaders,

      cache: "no-store",
    },
  );
}

export async function getSetupStatus(): Promise<SetupStatusResponse> {
  try {
    const response = await apiFetch("/setup/status");

    if (!response.ok) {
      return {
        setupComplete: false,
      };
    }

    return (await response.json()) as SetupStatusResponse;
  } catch {
    return {
      setupComplete: false,
    };
  }
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  try {
    const response = await apiFetch("/auth/me");

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as AuthUserResponse;

    return payload.user;
  } catch {
    return null;
  }
}

export async function getHealth(): Promise<PiCloudHealth | null> {
  try {
    const response = await apiFetch("/health");

    return (await response.json()) as PiCloudHealth;
  } catch {
    return null;
  }
}
