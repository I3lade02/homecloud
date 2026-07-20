import type {
  AuthUser,
} from "@picloud/contracts";

declare module "fastify" {
  interface FastifyRequest {
    authUser:
      AuthUser | null;
  }
}

export {};