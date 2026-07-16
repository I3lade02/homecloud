import type { FastifyInstance, FastifyRequest } from "fastify";

import { z } from "zod";

import {
  SetupAlreadyCompletedError,
  type AuthService,
} from "../auth/auth-service";

import { setSessionCookie } from "../auth/cookie";

type RouteApp = FastifyInstance<any, any, any, any>;

const setupSchema = z
  .object({
    displayName: z.string().trim().min(2).max(80),

    email: z.string().trim().email().max(320),

    password: z.string().min(12, "Heslo musí mít alespoň 12 znaků.").max(256),

    passwordConfirmation: z.string(),
  })
  .refine(
    (data) => data.password === data.passwordConfirmation,

    {
      path: ["passwordConfirmation"],

      message: "Hesla se neshodují.",
    },
  );

function requestMetadata(request: FastifyRequest) {
  return {
    ipAddress: request.ip,

    userAgent: request.headers["user-agent"],
  };
}

export async function registerSetupRoutes(
  app: RouteApp,

  options: {
    auth: AuthService;
    cookieSecure: boolean;
  },
) {
  app.get(
    "/setup/status",

    async () => ({
      setupComplete: await options.auth.isSetupComplete(),
    }),
  );

  app.post(
    "/setup/owner",

    {
      config: {
        rateLimit: {
          max: 5,

          timeWindow: "10 minutes",
        },
      },
    },

    async (request, reply) => {
      const parsed = setupSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({
          error: "validation_error",

          message: "Zkontroluj údaje prvního správce.",

          issues: parsed.error.flatten().fieldErrors,
        });
      }

      try {
        const user = await options.auth.createInitialOwner({
          email: parsed.data.email,

          displayName: parsed.data.displayName,

          password: parsed.data.password,

          request: requestMetadata(request),
        });

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

        return reply.code(201).send({
          user,
        });
      } catch (error) {
        if (error instanceof SetupAlreadyCompletedError) {
          return reply.code(409).send({
            error: "setup_already_completed",

            message: "Úvodní nastavení už bylo dokončeno.",
          });
        }

        throw error;
      }
    },
  );
}
