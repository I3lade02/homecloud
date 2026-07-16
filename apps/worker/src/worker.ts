import { Worker } from "bullmq";
import IORedis from "ioredis";

import { loadCommonConfig } from "@picloud/config";

import { SYSTEM_QUEUE_NAME, WORKER_HEARTBEAT_KEY } from "@picloud/contracts";

import { createLogger } from "@picloud/logger";

import { ensureStorageLayout } from "@picloud/storage";

const config = loadCommonConfig();

const logger = createLogger("picloud-worker");

const heartbeatConnection = new IORedis(config.VALKEY_URL, {
  maxRetriesPerRequest: null,
});

await ensureStorageLayout(config.STORAGE_PATH);

const worker = new Worker(
  SYSTEM_QUEUE_NAME,

  async (job) => {
    logger.info(
      {
        jobId: job.id,
        jobName: job.name,
        payload: job.data,
      },
      "Processing background job",
    );

    if (job.name === "demo") {
      await job.updateProgress(50);

      await new Promise((resolve) => setTimeout(resolve, 500));

      await job.updateProgress(100);

      return {
        processedAt: new Date().toISOString(),

        message: job.data.message,
      };
    }

    throw new Error(`Unknown job type: ${job.name}`);
  },

  {
    connection: heartbeatConnection,
    prefix: "picloud",
    concurrency: 4,
  },
);

const writeHeartbeat = async () => {
  await heartbeatConnection.set(
    WORKER_HEARTBEAT_KEY,
    new Date().toISOString(),
    "EX",
    30,
  );
};

await writeHeartbeat();

const heartbeatTimer = setInterval(() => {
  void writeHeartbeat().catch((error) => {
    logger.error({ error }, "Unable to write worker heartbeat");
  });
}, 10_000);

heartbeatTimer.unref();

worker.on("ready", () => {
  logger.info(
    {
      queue: SYSTEM_QUEUE_NAME,
    },
    "PiCloud worker is ready",
  );
});

worker.on("completed", (job, result) => {
  logger.info(
    {
      jobId: job.id,
      result,
    },
    "Background job completed",
  );
});

worker.on("failed", (job, error) => {
  logger.error(
    {
      jobId: job?.id,
      error,
    },
    "Background job failed",
  );
});

worker.on("error", (error) => {
  logger.error({ error }, "Worker connection error");
});

const shutdown = async (signal: string) => {
  logger.info({ signal }, "Shutting down PiCloud worker");

  clearInterval(heartbeatTimer);

  await worker.close();
  await heartbeatConnection.quit();

  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));

process.on("SIGINT", () => void shutdown("SIGINT"));
