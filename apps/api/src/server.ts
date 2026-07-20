import { randomUUID } from "node:crypto";

import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";

import { Queue } from "bullmq";

import Fastify from "fastify";
import IORedis from "ioredis";

import { loadApiConfig } from "@picloud/config";

import {
  SYSTEM_QUEUE_NAME,
  WORKER_HEARTBEAT_KEY,
  type HealthDependency,
  type PiCloudHealth,
} from "@picloud/contracts";

import { checkDatabase, createDatabase } from "@picloud/database";

import { createLogger } from "@picloud/logger";

import { checkStorage, ensureStorageLayout } from "@picloud/storage";

import { createAuthService } from "./auth/auth-service";

import { registerAuthRoutes } from "./routes/auth-routes";

import { registerSetupRoutes } from "./routes/setup-routes";

import { createRequireAuth } from "./auth/require-auth";

import { createDriveService } from "./drive/drive-service";

import { registerDriveRoutes } from "./routes/drive-routes";

const config = loadApiConfig();

const logger = createLogger("picloud-api");

const database = createDatabase(config.DATABASE_URL);

const valkey = new IORedis(
  config.VALKEY_URL,

  {
    maxRetriesPerRequest: 1,

    enableReadyCheck: true,
  },
);

const rateLimitValkey = new IORedis(
  config.VALKEY_URL,

  {
    connectTimeout: 10_000,

    maxRetriesPerRequest: 1,
  },
);

const systemQueue = new Queue(
  SYSTEM_QUEUE_NAME,

  {
    connection: valkey,

    prefix: "picloud",
  },
);

await ensureStorageLayout(config.STORAGE_PATH);

const auth = await createAuthService(
  database.db,

  config.SESSION_TTL_DAYS,
);

const drive = createDriveService(
  database.db,
);

const app = Fastify({
  loggerInstance: logger,

  requestIdHeader: "x-request-id",

  genReqId: () => randomUUID(),
});

app.decorateRequest(
  "authUser",
  null,
);

const requireAuth =
  createRequireAuth(
    auth,
  );

/*
 * Cookie plugin musí být
 * registrovaný před auth routami.
 */
await app.register(cookie);

await app.register(cors, {
  origin: config.WEB_ORIGIN,

  credentials: true,

  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
});

await app.register(
  rateLimit,

  {
    global: false,

    redis: rateLimitValkey,

    nameSpace: "picloud-rate-limit-",
  },
);

function dependencyDown(error: unknown): HealthDependency {
  return {
    state: "down",

    message:
      error instanceof Error ? error.message : "Unknown dependency error",
  };
}

async function collectHealth(): Promise<PiCloudHealth> {
  const [databaseResult, queueResult, storageResult, workerResult] =
    await Promise.allSettled([
      checkDatabase(database.pool),

      (async () => {
        const startedAt = performance.now();

        await valkey.ping();

        return Math.round(performance.now() - startedAt);
      })(),

      checkStorage(config.STORAGE_PATH),

      valkey.get(WORKER_HEARTBEAT_KEY),
    ]);

  const dependencies: PiCloudHealth["dependencies"] = {
    database:
      databaseResult.status === "fulfilled"
        ? {
            state: "up",

            latencyMs: databaseResult.value,
          }
        : dependencyDown(databaseResult.reason),

    queue:
      queueResult.status === "fulfilled"
        ? {
            state: "up",

            latencyMs: queueResult.value,
          }
        : dependencyDown(queueResult.reason),

    storage:
      storageResult.status === "fulfilled"
        ? {
            state: "up",

            latencyMs: storageResult.value,
          }
        : dependencyDown(storageResult.reason),

    worker:
      workerResult.status === "fulfilled" && workerResult.value
        ? {
            state: "up",

            message: `Last heartbeat: ${workerResult.value}`,
          }
        : {
            state: "down",

            message: "No recent worker heartbeat",
          },
  };

  const status = Object.values(dependencies).every(
    (dependency) => dependency.state === "up",
  )
    ? "healthy"
    : "degraded";

  return {
    status,

    service: config.PICLOUD_NAME,

    version: config.PICLOUD_VERSION,

    timestamp: new Date().toISOString(),

    uptimeSeconds: Math.round(process.uptime()),

    dependencies,
  };
}

app.get(
  "/health/live",

  async () => ({
    status: "alive",

    timestamp: new Date().toISOString(),
  }),
);

app.get(
  "/health",

  async (_request, reply) => {
    const health = await collectHealth();

    return reply.code(health.status === "healthy" ? 200 : 503).send(health);
  },
);

app.get(
  "/health/ready",

  async (_request, reply) => {
    const health = await collectHealth();

    const ready = [
      health.dependencies.database,

      health.dependencies.queue,

      health.dependencies.storage,
    ].every((dependency) => dependency.state === "up");

    return reply.code(ready ? 200 : 503).send({
      ready,

      timestamp: health.timestamp,

      dependencies: {
        database: health.dependencies.database,

        queue: health.dependencies.queue,

        storage: health.dependencies.storage,
      },
    });
  },
);

app.post<{
  Body: {
    message?: string;
  };
}>(
  "/jobs/demo",

  async (request, reply) => {
    const message = request.body?.message?.trim() || "Hello from PiCloud";

    const job = await systemQueue.add(
      "demo",

      {
        message,

        requestedAt: new Date().toISOString(),
      },

      {
        attempts: 3,

        backoff: {
          type: "exponential",

          delay: 1_000,
        },

        removeOnComplete: {
          count: 100,
        },

        removeOnFail: {
          count: 100,
        },
      },
    );

    return reply.code(202).send({
      accepted: true,

      jobId: job.id,

      queue: SYSTEM_QUEUE_NAME,
    });
  },
);

await registerSetupRoutes(
  app as any,

  {
    auth,

    cookieSecure: config.COOKIE_SECURE,
  },
);

await registerAuthRoutes(
  app as any,

  {
    auth,

    cookieSecure: config.COOKIE_SECURE,
  },
);

await registerDriveRoutes(
  app as any,

  {
    drive,
    requireAuth,
  },
);

const shutdown = async (signal: string) => {
  app.log.info(
    {
      signal,
    },

    "Shutting down PiCloud API",
  );

  await app.close();

  await systemQueue.close();

  await valkey.quit();

  await rateLimitValkey.quit();

  await database.pool.end();

  process.exit(0);
};

process.on(
  "SIGTERM",

  () => void shutdown("SIGTERM"),
);

process.on(
  "SIGINT",

  () => void shutdown("SIGINT"),
);

try {
  await app.listen({
    host: config.API_HOST,

    port: config.API_PORT,
  });
} catch (error) {
  app.log.error(
    error,

    "Unable to start PiCloud API",
  );

  process.exit(1);
}
