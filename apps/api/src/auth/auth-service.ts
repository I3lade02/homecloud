import { and, count, eq, gt, isNull, sql } from "drizzle-orm";

import type { AuthUser } from "@picloud/contracts";

import {
  auditLogs,
  sessions,
  users,
  type Database,
  type UserRecord,
} from "@picloud/database";

import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  verifyPassword,
} from "./security";

export interface RequestMetadata {
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

export interface SessionResult {
  token: string;
  expiresAt: Date;
}

export class SetupAlreadyCompletedError extends Error {
  constructor() {
    super("Initial PiCloud setup has already been completed");

    this.name = "SetupAlreadyCompletedError";
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toAuthUser(user: UserRecord): AuthUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,

    createdAt: user.createdAt.toISOString(),

    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  };
}

export async function createAuthService(db: Database, sessionTtlDays: number) {
  /*
   * Použije se při přihlášení
   * neexistujícího uživatele.
   *
   * Díky tomu hashování proběhne
   * i pro neznámý e-mail a endpoint
   * se chová časově podobně.
   */
  const dummyPasswordHash = await hashPassword(
    "PiCloud dummy password used only for timing equalization",
  );

  async function writeAuditLog(
    event: string,

    metadata: RequestMetadata & {
      actorUserId?: string | undefined;

      details?: Record<string, unknown> | undefined;
    },
  ): Promise<void> {
    await db.insert(auditLogs).values({
      actorUserId: metadata.actorUserId,

      event,

      ipAddress: metadata.ipAddress,

      userAgent: metadata.userAgent,

      metadata: metadata.details,
    });
  }

  async function isSetupComplete(): Promise<boolean> {
    const [result] = await db
      .select({
        value: count(),
      })
      .from(users);

    return Number(result?.value ?? 0) > 0;
  }

  async function createInitialOwner(input: {
    email: string;
    displayName: string;
    password: string;
    request: RequestMetadata;
  }): Promise<AuthUser> {
    const passwordHash = await hashPassword(input.password);

    const email = normalizeEmail(input.email);

    const owner = await db.transaction(async (transaction) => {
      /*
       * Zabrání vytvoření dvou
       * owner účtů při dvou
       * současných setup requestech.
       */
      await transaction.execute(
        sql`
              SELECT
                pg_advisory_xact_lock(
                  70125001
                )
            `,
      );

      const [existingUser] = await transaction
        .select({
          id: users.id,
        })
        .from(users)
        .limit(1);

      if (existingUser) {
        throw new SetupAlreadyCompletedError();
      }

      const [createdUser] = await transaction
        .insert(users)
        .values({
          email,

          displayName: input.displayName.trim(),

          passwordHash,

          role: "owner",
        })
        .returning();

      if (!createdUser) {
        throw new Error("Unable to create the initial owner account");
      }

      await transaction.insert(auditLogs).values({
        actorUserId: createdUser.id,

        event: "system.setup_completed",

        ipAddress: input.request.ipAddress,

        userAgent: input.request.userAgent,

        metadata: {
          email: createdUser.email,
        },
      });

      return createdUser;
    });

    return toAuthUser(owner);
  }

  async function authenticate(input: {
    email: string;
    password: string;
    request: RequestMetadata;
  }): Promise<AuthUser | null> {
    const email = normalizeEmail(input.email);

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    const passwordMatches = await verifyPassword(
      user?.passwordHash ?? dummyPasswordHash,

      input.password,
    );

    if (!user || !user.isActive || !passwordMatches) {
      await writeAuditLog("user.login_failed", {
        ...input.request,

        details: {
          email,
        },
      });

      return null;
    }

    const now = new Date();

    const [updatedUser] = await db
      .update(users)
      .set({
        lastLoginAt: now,
        updatedAt: now,
      })
      .where(eq(users.id, user.id))
      .returning();

    await writeAuditLog("user.login_succeeded", {
      ...input.request,

      actorUserId: user.id,
    });

    return toAuthUser(
      updatedUser ?? {
        ...user,
        lastLoginAt: now,
      },
    );
  }

  async function createSession(
    userId: string,
    request: RequestMetadata,
  ): Promise<SessionResult> {
    const token = createSessionToken();

    const tokenHash = hashSessionToken(token);

    const expiresAt = new Date(
      Date.now() + sessionTtlDays * 24 * 60 * 60 * 1_000,
    );

    await db.insert(sessions).values({
      userId,
      tokenHash,
      expiresAt,

      ipAddress: request.ipAddress,

      userAgent: request.userAgent,
    });

    return {
      token,
      expiresAt,
    };
  }

  async function getUserBySessionToken(
    token: string | undefined,
  ): Promise<AuthUser | null> {
    if (!token) {
      return null;
    }

    const tokenHash = hashSessionToken(token);

    const now = new Date();

    const [result] = await db
      .select({
        sessionId: sessions.id,

        lastSeenAt: sessions.lastSeenAt,

        userId: users.id,

        email: users.email,

        displayName: users.displayName,

        passwordHash: users.passwordHash,

        role: users.role,

        isActive: users.isActive,

        createdAt: users.createdAt,

        updatedAt: users.updatedAt,

        lastLoginAt: users.lastLoginAt,
      })
      .from(sessions)
      .innerJoin(
        users,

        eq(sessions.userId, users.id),
      )
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),

          isNull(sessions.revokedAt),

          gt(sessions.expiresAt, now),

          eq(users.isActive, true),
        ),
      )
      .limit(1);

    if (!result) {
      return null;
    }

    /*
     * lastSeenAt neaktualizujeme
     * při každém requestu.
     * Maximálně jednou za 5 minut.
     */
    if (now.getTime() - result.lastSeenAt.getTime() > 5 * 60 * 1_000) {
      await db
        .update(sessions)
        .set({
          lastSeenAt: now,
        })
        .where(eq(sessions.id, result.sessionId));
    }

    return toAuthUser({
      id: result.userId,
      email: result.email,

      displayName: result.displayName,

      passwordHash: result.passwordHash,

      role: result.role,

      isActive: result.isActive,

      createdAt: result.createdAt,

      updatedAt: result.updatedAt,

      lastLoginAt: result.lastLoginAt,
    });
  }

  async function revokeSession(
    token: string | undefined,
    request: RequestMetadata,
  ): Promise<void> {
    if (!token) {
      return;
    }

    const tokenHash = hashSessionToken(token);

    const now = new Date();

    const [revoked] = await db
      .update(sessions)
      .set({
        revokedAt: now,
      })
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),

          isNull(sessions.revokedAt),
        ),
      )
      .returning({
        userId: sessions.userId,
      });

    if (revoked) {
      await writeAuditLog("user.logout", {
        ...request,

        actorUserId: revoked.userId,
      });
    }
  }

  return {
    authenticate,
    createInitialOwner,
    createSession,
    getUserBySessionToken,
    isSetupComplete,
    revokeSession,
  };
}

export type AuthService = Awaited<ReturnType<typeof createAuthService>>;
