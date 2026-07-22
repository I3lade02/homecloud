import { createHash } from "node:crypto";

import { createReadStream } from "node:fs";

import { and, eq, sql } from "drizzle-orm";

import {
  auditLogs,
  blobs,
  driveNodes,
  fileEntries,
  uploadSessions,
  type Database,
} from "@picloud/database";

import {
  ensureBlobFromTemporary,
  getBlobStorageKey,
  getTemporaryUploadKey,
  removeStoredObject,
  resolveStoragePath,
  statStoredObject,
} from "@picloud/storage";

async function calculateSha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");

  const stream = createReadStream(filePath);

  for await (const chunk of stream) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

export function createUploadFinalizer(db: Database, storagePath: string) {
  async function finalizeUpload(uploadId: string): Promise<{
    nodeId: string;
  } | null> {
    const [result] = await db
      .select({
        session: uploadSessions,

        node: driveNodes,

        file: fileEntries,
      })
      .from(uploadSessions)
      .innerJoin(
        driveNodes,

        eq(driveNodes.id, uploadSessions.nodeId),
      )
      .innerJoin(
        fileEntries,

        eq(fileEntries.nodeId, driveNodes.id),
      )
      .where(eq(uploadSessions.id, uploadId))
      .limit(1);

    /*
     * Upload mohl být mezitím
     * zrušený.
     */
    if (!result) {
      return null;
    }

    if (result.session.status === "completed") {
      return {
        nodeId: result.node.id,
      };
    }

    if (
      result.session.status !== "processing" ||
      result.session.receivedSize !== result.session.expectedSize
    ) {
      throw new Error(`Upload ${uploadId} is not ready for finalization`);
    }

    const temporaryKey = getTemporaryUploadKey(uploadId);

    const temporaryPath = resolveStoragePath(storagePath, temporaryKey);

    const temporaryStat = await statStoredObject(storagePath, temporaryKey);

    if (BigInt(temporaryStat.size) !== result.session.expectedSize) {
      throw new Error("Temporary upload size does not match the database");
    }

    const checksumSha256 = await calculateSha256(temporaryPath);

    const blobKey = getBlobStorageKey(checksumSha256);

    /*
     * Dočasný soubor zatím
     * nemažeme.
     */
    await ensureBlobFromTemporary(storagePath, temporaryKey, blobKey);

    await db.transaction(async (transaction) => {
      /*
       * Serializuje operace
       * se stejným hashem.
       */
      await transaction.execute(
        sql`
            SELECT
              pg_advisory_xact_lock(
                hashtext(
                  ${checksumSha256}
                )
              )
          `,
      );

      await transaction
        .insert(blobs)
        .values({
          checksumSha256,

          storageKey: blobKey,

          sizeBytes: result.session.expectedSize,
        })
        .onConflictDoNothing({
          target: blobs.checksumSha256,
        });

      const [blob] = await transaction
        .select()
        .from(blobs)
        .where(eq(blobs.checksumSha256, checksumSha256))
        .limit(1);

      if (!blob) {
        throw new Error("Unable to load finalized blob");
      }

      if (blob.sizeBytes !== result.session.expectedSize) {
        throw new Error(
          "Checksum collision or inconsistent blob size detected",
        );
      }

      const now = new Date();

      await transaction
        .update(fileEntries)
        .set({
          blobId: blob.id,

          sizeBytes: blob.sizeBytes,

          status: "ready",

          updatedAt: now,
        })
        .where(eq(fileEntries.nodeId, result.node.id));

      await transaction
        .update(uploadSessions)
        .set({
          status: "completed",

          completedAt: now,

          updatedAt: now,

          errorMessage: null,
        })
        .where(
          and(
            eq(uploadSessions.id, uploadId),

            eq(uploadSessions.status, "processing"),
          ),
        );

      await transaction.insert(auditLogs).values({
        actorUserId: result.session.ownerId,

        event: "file.upload_completed",

        metadata: {
          uploadId,

          nodeId: result.node.id,

          name: result.node.name,

          sizeBytes: blob.sizeBytes.toString(),

          checksumSha256,
        },
      });
    });

    /*
     * Temporary mažeme až po
     * úspěšném DB commitu.
     */
    await removeStoredObject(storagePath, temporaryKey);

    return {
      nodeId: result.node.id,
    };
  }

  async function markUploadFailed(
    uploadId: string,
    message: string,
  ): Promise<void> {
    const [session] = await db
      .select()
      .from(uploadSessions)
      .where(eq(uploadSessions.id, uploadId))
      .limit(1);

    if (!session || session.status === "completed") {
      return;
    }

    const now = new Date();

    await db.transaction(async (transaction) => {
      await transaction
        .update(uploadSessions)
        .set({
          status: "failed",

          errorMessage: message.slice(0, 1_000),

          updatedAt: now,
        })
        .where(eq(uploadSessions.id, uploadId));

      await transaction
        .update(fileEntries)
        .set({
          status: "failed",

          updatedAt: now,
        })
        .where(eq(fileEntries.nodeId, session.nodeId));

      await transaction.insert(auditLogs).values({
        actorUserId: session.ownerId,

        event: "file.upload_failed",

        metadata: {
          uploadId,
          message,
        },
      });
    });
  }

  return {
    finalizeUpload,
    markUploadFailed,
  };
}
