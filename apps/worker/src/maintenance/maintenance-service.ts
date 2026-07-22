import { and, eq, inArray, lt } from "drizzle-orm";

import {
  auditLogs,
  driveNodes,
  fileEntries,
  uploadSessions,
  type Database,
} from "@picloud/database";

import { getTemporaryUploadKey, removeStoredObject } from "@picloud/storage";

export function createMaintenanceService(
  db: Database,

  options: {
    storagePath: string;

    enqueueFileProcessing: (nodeId: string) => Promise<void>;
  },
) {
  async function recoverStalePreviewJobs() {
    /**
     * Worker mohl být vypnutý
     * uprostřed zpracování
     */
    const staleBefore = new Date(Date.now() - 30 * 60 * 1_000);

    const recovered = await db
      .update(fileEntries)
      .set({
        previewStatus: "pending",

        previewError: "Previous preview job did not finish",

        updatedAt: new Date(),
      })
      .where(
        and(
          eq(fileEntries.status, "ready"),

          eq(fileEntries.previewStatus, "processing"),

          lt(fileEntries.updatedAt, staleBefore),
        ),
      )
      .returning({
        nodeId: fileEntries.nodeId,
      });

    return recovered.length;
  }

  async function enqueuePendingPreviews() {
    const pendingFiles = await db
      .select({
        nodeId: fileEntries.nodeId,
      })
      .from(fileEntries)
      .where(
        and(
          eq(fileEntries.status, "ready"),

          eq(fileEntries.previewStatus, "pending"),
        ),
      )
      .limit(100);

    for (const file of pendingFiles) {
      await options.enqueueFileProcessing(file.nodeId);
    }

    return pendingFiles.length;
  }

  async function expireOldUploads() {
    const now = new Date();

    const expiredUploads = await db
      .select()
      .from(uploadSessions)
      .where(
        and(
          lt(uploadSessions.expiresAt, now),

          inArray(
            uploadSessions.status,

            ["created", "uploading", "failed"],
          ),
        ),
      )
      .limit(100);

    for (const upload of expiredUploads) {
      await db.transaction(async (transaction) => {
        await transaction.insert(auditLogs).values({
          actorUserId: upload.ownerId,

          event: "file.upload_expired",

          metadata: {
            uploadId: upload.id,

            nodeId: upload.nodeId,
          },
        });

        /**
         * Cascade odstraní
         * file entry i upload session
         */

        await transaction
          .delete(driveNodes)
          .where(and(eq(driveNodes.id, upload.ownerId)));
      });

      await removeStoredObject(
        options.storagePath,

        getTemporaryUploadKey(upload.id),
      );
    }

    return expiredUploads.length;
  }

  async function runMaintenance() {
    const recoveredPreviews = await recoverStalePreviewJobs();

    const queuedPreviews = await enqueuePendingPreviews();

    const expiredUploads = await expireOldUploads();

    return {
      recoveredPreviews,
      queuedPreviews,
      expiredUploads,
    };
  }

  return {
    runMaintenance,
  };
}
