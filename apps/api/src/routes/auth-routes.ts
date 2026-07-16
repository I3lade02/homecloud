import type { FastifyInstance, FastifyRequest } from "fastify";

import { z } from "zod";

import type { AuthService } from "../auth/auth-service";

import {
  clearSessionCookie,
  SESSION_COOKIE_NAME,
  setSessionCookie,
} from "../auth/cookie";

type RouteApp = FastifyInstance<any, any, any, any>;

const loginSchema = z.object({
  email: z.string().trim().email().max(320),

  password: z.string().min(1).max(256),
});

function requestMetadata(request: FastifyRequest) {
  return {
    ipAddress: request.ip,

    userAgent: request.headers["user-agent"],
  };
}

export async function registerAuthRoutes(
  app: RouteApp,

  options: {
    auth: AuthService;
    cookieSecure: boolean;
  },
) {
  app.post(
    "/auth/login",

    {
      config: {
        rateLimit: {
          max: 10,

          timeWindow: "1 minute",
        },
      },
    },

    async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({
          error: "validation_error",

          message: "Zkontroluj e-mail a heslo.",
        });
      }

      const user = await options.auth.authenticate({
        ...parsed.data,

        request: requestMetadata(request),
      });

      if (!user) {
        return reply.code(401).send({
          error: "invalid_credentials",

          message: "Nesprávný e-mail nebo heslo.",
        });
      }

      const session = await options.auth.createSession(
        user.id,

        requestMetadata(request),
      );

      setSessionCookie(
        reply,
        session.token,
        session.expiresAt,
        options.cookieSecure,
      );

      return reply.send({
        user,
      });
    },
  );

  app.post(
    "/auth/logout",

    async (request, reply) => {
      await options.auth.revokeSession(
        request.cookies[SESSION_COOKIE_NAME],

        requestMetadata(request),
      );

      clearSessionCookie(reply, options.cookieSecure);

      return reply.code(204).send();
    },
  );

  app.get(
    "/auth/me",

    async (request, reply) => {
      const user = await options.auth.getUserBySessionToken(
        request.cookies[SESSION_COOKIE_NAME],
      );

      if (!user) {
        return reply.code(401).send({
          error: "unauthorized",

          message: "Přihlášení vypršelo nebo není platné.",
        });
      }

      return reply.send({
        user,
      });
    },
  );
}
