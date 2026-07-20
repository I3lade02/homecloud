import type {
    FastifyReply,
    FastifyRequest,
} from "fastify";

import type {
    AuthService,
} from "./auth-service";

import {
    SESSION_COOKIE_NAME,
} from "./cookie";

export type RequireAuthHandler = (
    request: FastifyRequest,
    reply: FastifyReply,
) => Promise<void>;

export function createRequireAuth(
    auth: AuthService,
): RequireAuthHandler {
    return async (
        request,
        reply,
    ) => {
        const sessionToken = 
        request.cookies[
            SESSION_COOKIE_NAME
        ];

        const user =
            await auth
                .getUserBySessionToken(
                    sessionToken,
                );
        if (!user) {
            await reply
                .code(401)
                .send({
                    error:
                        "unauthorized",

                    message: 
                        "Pro tuto operaci se musíš přihlásit",
                });

            return;
        }

        request.authUser =
            user;
    };
}