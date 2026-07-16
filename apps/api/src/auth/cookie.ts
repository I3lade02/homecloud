import type { FastifyReply } from "fastify";

export const SESSION_COOKIE_NAME = "picloud_session";

export function setSessionCookie(
  reply: FastifyReply,
  token: string,
  expiresAt: Date,
  secure: boolean,
): void {
  reply.setCookie(SESSION_COOKIE_NAME, token, {
    path: "/",

    httpOnly: true,

    secure,

    sameSite: "lax",

    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply, secure: boolean): void {
  reply.clearCookie(SESSION_COOKIE_NAME, {
    path: "/",

    httpOnly: true,

    secure,

    sameSite: "lax",
  });
}
