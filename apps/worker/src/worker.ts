import { Queue, Worker } from "bullmq";

import IORedis from "ioredis";

import { loadCommonConfig } from "@picloud/config";

import {
  FINALIZE_UPLOAD_JOB_NAME,
  MAINTENANCE_JOB_NAME,
  MAINTENANCE_SCHEDULER_ID,
  PROCESS_FILE_JOB_NAME,
  SYSTEM_QUEUE_NAME,
  WORKER_HEARTBEAT_KEY,
  type FinalizeUploadJobData,
  type ProcessFileJobData,
} from "@picloud/contracts";

import { createDatabase } from "@picloud/database";

import { createLogger } from "@picloud/logger";

import { ensureStorageLayout } from "@picloud/storage";

import { createFileProcessor } from "./files/file-processor";

import { createMaintenanceService } from "./maintenance/maintenance-service";

import { createUploadFinalizer } from "./uploads/upload-finalizer";

const config = loadCommonConfig();

const logger = createLogger("picloud-worker");

const database = createDatabase(config.DATABASE_URL);

/*
 * Worker connection musí mít
 * maxRetriesPerRequest null.
 */
const workerConnection = new IORedis(
  config.VALKEY_URL,

  {
    maxRetriesPerRequest: null,
  },
);

/*
 * Queue používá samostatné
 * spojení.
 */
const queueConnection = new IORedis(
  config.VALKEY_URL,

  {
    maxRetriesPerRequest: 1,
  },
);

await ensureStorageLayout(config.STORAGE_PATH);

const systemQueue = new Queue(
  SYSTEM_QUEUE_NAME,

  {
    connection: queueConnection,

    prefix: "picloud",
  },
);

const uploadFinalizer = createUploadFinalizer(database.db, config.STORAGE_PATH);

const fileProcessor = createFileProcessor(database.db, config.STORAGE_PATH);

async function enqueueFileProcessing(nodeId: string) {
  await systemQueue.add(
    PROCESS_FILE_JOB_NAME,

    {
      nodeId,
    } satisfies ProcessFileJobData,

    {
      attempts: 2,

      backoff: {
        type: "exponential",

        delay: 2_000,
      },

      removeOnComplete: {
        count: 200,
      },

      removeOnFail: {
        count: 200,
      },
    },
  );
}

const maintenance = createMaintenanceService(
  database.db,

  {
    storagePath: config.STORAGE_PATH,

    enqueueFileProcessing,
  },
);

/*
 * Pravidelná údržba každých
 * patnáct minut.
 */
await systemQueue.upsertJobScheduler(
  MAINTENANCE_SCHEDULER_ID,

  {
    every: 15 * 60 * 1_000,
  },

  {
    name: MAINTENANCE_JOB_NAME,

    data: {},

    opts: {
      attempts: 2,

      backoff: {
        type: "exponential",

        delay: 5_000,
      },

      removeOnComplete: 50,

      removeOnFail: 50,
    },
  },
);

/*
 * Údržbu spustíme jednou
 * také okamžitě po startu.
 */
await systemQueue.add(
  MAINTENANCE_JOB_NAME,

  {},

  {
    removeOnComplete: {
      count: 50,
    },

    removeOnFail: {
      count: 50,
    },
  },
);

const worker = new Worker(
  SYSTEM_QUEUE_NAME,

  async (job) => {
    logger.info(
      {
        jobId: job.id,

        jobName: job.name,
      },

      "Processing background job",
    );

    if (job.name === FINALIZE_UPLOAD_JOB_NAME) {
      const data = job.data as FinalizeUploadJobData;

      const finalized = await uploadFinalizer.finalizeUpload(data.uploadId);

      if (finalized) {
        await enqueueFileProcessing(finalized.nodeId);
      }

      return {
        uploadId: data.uploadId,

        nodeId: finalized?.nodeId ?? null,

        finalizedAt: new Date().toISOString(),
      };
    }

    if (job.name === PROCESS_FILE_JOB_NAME) {
      const data = job.data as ProcessFileJobData;

      await fileProcessor.processFile(data.nodeId);

      return {
        nodeId: data.nodeId,

        processedAt: new Date().toISOString(),
      };
    }

    if (job.name === MAINTENANCE_JOB_NAME) {
      return maintenance.runMaintenance();
    }

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
    connection: workerConnection,

    prefix: "picloud",

    concurrency: 4,
  },
);

const writeHeartbeat = async () => {
  await workerConnection.set(
    WORKER_HEARTBEAT_KEY,

    new Date().toISOString(),

    "EX",

    30,
  );
};

await writeHeartbeat();

const heartbeatTimer = setInterval(
  () => {
    void writeHeartbeat().catch((error) => {
      logger.error(
        {
          error,
        },

        "Unable to write worker heartbeat",
      );
    });
  },

  10_000,
);

heartbeatTimer.unref();

worker.on(
  "ready",

  () => {
    logger.info(
      {
        queue: SYSTEM_QUEUE_NAME,
      },

      "PiCloud worker is ready",
    );
  },
);

worker.on(
  "completed",

  (job, result) => {
    logger.info(
      {
        jobId: job.id,

        jobName: job.name,

        result,
      },

      "Background job completed",
    );
  },
);

worker.on(
  "failed",

  (job, error) => {
    logger.error(
      {
        jobId: job?.id,

        jobName: job?.name,

        attemptsMade: job?.attemptsMade,

        error,
      },

      "Background job failed",
    );

    if (
      job?.name === FINALIZE_UPLOAD_JOB_NAME &&
      job.attemptsMade >= (job.opts.attempts ?? 1)
    ) {
      const data = job.data as FinalizeUploadJobData;

      void uploadFinalizer
        .markUploadFailed(data.uploadId, error.message)
        .catch((markError) => {
          logger.error(
            {
              uploadId: data.uploadId,

              error: markError,
            },

            "Unable to mark upload as failed",
          );
        });
    }
  },
);

worker.on(
  "error",

  (error) => {
    logger.error(
      {
        error,
      },

      "Worker connection error",
    );
  },
);

const shutdown = async (signal: string) => {
  logger.info(
    {
      signal,
    },

    "Shutting down PiCloud worker",
  );

  clearInterval(heartbeatTimer);

  await worker.close();

  await systemQueue.close();

  await workerConnection.quit();

  await queueConnection.quit();

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
