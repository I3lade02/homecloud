import { createWriteStream } from "node:fs";

import { stat, truncate } from "node:fs/promises";

import { Transform, type Readable, type TransformCallback } from "node:stream";

import { pipeline } from "node:stream/promises";

import { and, eq, sql } from "drizzle-orm";

import type { UploadSessionView } from "@picloud/contracts";

import {
  auditLogs,
  blobs,
  driveNodes,
  fileEntries,
  uploadSessions,
  type Database,
  type DriveNodeRecord,
  type UploadSessionRecord,
} from "@picloud/database";

import {
  getTemporaryUploadKey,
  removeStoredObject,
  resolveStoragePath,
} from "@picloud/storage";

import {
  DuplicateDriveNameError,
  prepareDriveName,
} from "../drive/drive-service";

/*
 * Doménové chyby
 */

export class UploadNotFoundError extends Error {
  constructor() {
    super("Upload session nebyla nalezena.");

    this.name = "UploadNotFoundError";
  }
}

export class UploadSizeLimitError extends Error {
  constructor(public readonly maximumBytes: number) {
    super("Soubor překračuje maximální povolenou velikost.");

    this.name = "UploadSizeLimitError";
  }
}

export class UploadOffsetMismatchError extends Error {
  constructor(public readonly expectedOffset: bigint) {
    super("Upload offset neodpovídá stavu na serveru.");

    this.name = "UploadOffsetMismatchError";
  }
}

export class UploadStateError extends Error {
  constructor(message: string) {
    super(message);

    this.name = "UploadStateError";
  }
}

export class UploadExpiredError extends Error {
  constructor() {
    super("Upload session vypršela.");

    this.name = "UploadExpiredError";
  }
}

export class UploadChunkTooLargeError extends Error {
  constructor() {
    super("Odeslaný chunk je příliš velký.");

    this.name = "UploadChunkTooLargeError";
  }
}

export class UploadStorageMismatchError extends Error {
  constructor() {
    super("Dočasný soubor neodpovídá stavu upload session.");

    this.name = "UploadStorageMismatchError";
  }
}

function isFileSystemError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (
      error as {
        code?: unknown;
      }
    ).code === "23505"
  );
}

function normalizeMimeType(value: string): string {
  const mimeType = value.trim().toLowerCase();

  const validMimeType = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/;

  if (!mimeType || mimeType.length > 255 || !validMimeType.test(mimeType)) {
    return "application/octet-stream";
  }

  return mimeType;
}

function toUploadView(
  session: UploadSessionRecord,

  node: DriveNodeRecord,

  chunkSizeBytes: number,
): UploadSessionView {
  if (!node.parentId) {
    throw new Error("File upload node has no parent");
  }

  return {
    id: session.id,

    nodeId: session.nodeId,

    parentId: node.parentId,

    name: node.name,

    expectedSizeBytes: session.expectedSize.toString(),

    receivedSizeBytes: session.receivedSize.toString(),

    status: session.status,

    errorMessage: session.errorMessage,

    createdAt: session.createdAt.toISOString(),

    expiresAt: session.expiresAt.toISOString(),

    completedAt: session.completedAt?.toISOString() ?? null,

    chunkSizeBytes,
  };
}

export function createUploadService(
  db: Database,

  options: {
    storagePath: string;

    maximumUploadBytes: number;

    chunkSizeBytes: number;

    sessionTtlHours: number;
  },
) {
  async function findOwnedUpload(ownerId: string, uploadId: string) {
    const [result] = await db
      .select({
        session: uploadSessions,

        node: driveNodes,
      })
      .from(uploadSessions)
      .innerJoin(
        driveNodes,

        eq(driveNodes.id, uploadSessions.nodeId),
      )
      .where(
        and(
          eq(uploadSessions.id, uploadId),

          eq(uploadSessions.ownerId, ownerId),

          eq(driveNodes.ownerId, ownerId),
        ),
      )
      .limit(1);

    return result ?? null;
  }

  async function requireParentFolder(ownerId: string, parentId: string) {
    const [folder] = await db
      .select()
      .from(driveNodes)
      .where(
        and(
          eq(driveNodes.id, parentId),

          eq(driveNodes.ownerId, ownerId),

          eq(driveNodes.kind, "folder"),
        ),
      )
      .limit(1);

    if (!folder) {
      throw new UploadNotFoundError();
    }

    return folder;
  }

  async function createUpload(input: {
    ownerId: string;

    parentId: string;

    name: string;

    sizeBytes: bigint;

    mimeType: string;

    ipAddress?: string | undefined;

    userAgent?: string | undefined;
  }): Promise<UploadSessionView> {
    if (input.sizeBytes > BigInt(options.maximumUploadBytes)) {
      throw new UploadSizeLimitError(options.maximumUploadBytes);
    }

    await requireParentFolder(input.ownerId, input.parentId);

    const preparedName = prepareDriveName(input.name);

    const expiresAt = new Date(
      Date.now() + options.sessionTtlHours * 60 * 60 * 1_000,
    );

    try {
      const result = await db.transaction(async (transaction) => {
        const [node] = await transaction
          .insert(driveNodes)
          .values({
            ownerId: input.ownerId,

            parentId: input.parentId,

            kind: "file",

            name: preparedName.name,

            normalizedName: preparedName.normalizedName,

            isRoot: false,
          })
          .returning();

        if (!node) {
          throw new Error("Unable to reserve file node");
        }

        await transaction.insert(fileEntries).values({
          nodeId: node.id,

          blobId: null,

          sizeBytes: input.sizeBytes,

          mimeType: normalizeMimeType(input.mimeType),

          status: "pending",
        });

        const [session] = await transaction
          .insert(uploadSessions)
          .values({
            ownerId: input.ownerId,

            nodeId: node.id,

            expectedSize: input.sizeBytes,

            receivedSize: 0n,

            status: "created",

            expiresAt,
          })
          .returning();

        if (!session) {
          throw new Error("Unable to create upload session");
        }

        await transaction.insert(auditLogs).values({
          actorUserId: input.ownerId,

          event: "file.upload_created",

          ipAddress: input.ipAddress,

          userAgent: input.userAgent,

          metadata: {
            uploadId: session.id,

            nodeId: node.id,

            name: node.name,

            sizeBytes: input.sizeBytes.toString(),
          },
        });

        return {
          session,
          node,
        };
      });

      return toUploadView(result.session, result.node, options.chunkSizeBytes);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateDriveNameError();
      }

      throw error;
    }
  }

  async function getUpload(
    ownerId: string,
    uploadId: string,
  ): Promise<UploadSessionView> {
    const result = await findOwnedUpload(ownerId, uploadId);

    if (!result) {
      throw new UploadNotFoundError();
    }

    return toUploadView(result.session, result.node, options.chunkSizeBytes);
  }

  async function appendChunk(input: {
    ownerId: string;

    uploadId: string;

    offset: bigint;

    body: Readable;
  }): Promise<{
    upload: UploadSessionView;

    readyForFinalization: boolean;
  }> {
    return db.transaction(async (transaction) => {
      /*
       * Advisory lock zamezí tomu,
       * aby dva API procesy zapisovaly
       * stejný upload současně.
       */
      await transaction.execute(
        sql`
            SELECT
              pg_advisory_xact_lock(
                hashtext(
                  ${input.uploadId}
                )
              )
          `,
      );

      const [result] = await transaction
        .select({
          session: uploadSessions,

          node: driveNodes,
        })
        .from(uploadSessions)
        .innerJoin(
          driveNodes,

          eq(driveNodes.id, uploadSessions.nodeId),
        )
        .where(
          and(
            eq(uploadSessions.id, input.uploadId),

            eq(uploadSessions.ownerId, input.ownerId),

            eq(driveNodes.ownerId, input.ownerId),
          ),
        )
        .limit(1);

      if (!result) {
        throw new UploadNotFoundError();
      }

      const { session, node } = result;

      if (session.expiresAt < new Date()) {
        throw new UploadExpiredError();
      }

      if (session.status !== "created" && session.status !== "uploading") {
        throw new UploadStateError(
          `Upload nelze zapisovat ve stavu „${session.status}“.`,
        );
      }

      if (session.receivedSize !== input.offset) {
        throw new UploadOffsetMismatchError(session.receivedSize);
      }

      const remainingBytes = session.expectedSize - session.receivedSize;

      if (remainingBytes <= 0n) {
        throw new UploadStateError("Upload už přijal všechna očekávaná data.");
      }

      const temporaryKey = getTemporaryUploadKey(session.id);

      const temporaryPath = resolveStoragePath(
        options.storagePath,
        temporaryKey,
      );

      let storedSize = 0n;

      try {
        const temporaryStat = await stat(temporaryPath);

        storedSize = BigInt(temporaryStat.size);
      } catch (error) {
        if (!isFileSystemError(error) || error.code !== "ENOENT") {
          throw error;
        }
      }

      if (storedSize !== session.receivedSize) {
        throw new UploadStorageMismatchError();
      }

      const maximumChunkBytes = Math.min(
        options.chunkSizeBytes,

        Number(remainingBytes),
      );

      let chunkBytes = 0;

      const meter = new Transform({
        transform(
          chunk: Buffer | string,

          _encoding: BufferEncoding,

          callback: TransformCallback,
        ) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

          chunkBytes += buffer.length;

          if (chunkBytes > maximumChunkBytes) {
            callback(new UploadChunkTooLargeError());

            return;
          }

          callback(null, buffer);
        },
      });

      try {
        await pipeline(
          input.body,
          meter,
          createWriteStream(temporaryPath, {
            flags: "a",
          }),
        );
      } catch (error) {
        /*
         * Odstraníme případnou
         * částečně zapsanou část.
         */
        try {
          await truncate(temporaryPath, Number(session.receivedSize));
        } catch {
          // Původní chyba je důležitější.
        }

        throw error;
      }

      if (chunkBytes === 0 && remainingBytes > 0n) {
        throw new UploadStateError("Chunk neobsahoval žádná data.");
      }

      const newOffset = session.receivedSize + BigInt(chunkBytes);

      const completed = newOffset === session.expectedSize;

      const now = new Date();

      const nextStatus = completed ? "processing" : "uploading";

      const [updatedSession] = await transaction
        .update(uploadSessions)
        .set({
          receivedSize: newOffset,

          status: nextStatus,

          startedAt: session.startedAt ?? now,

          updatedAt: now,

          errorMessage: null,
        })
        .where(eq(uploadSessions.id, session.id))
        .returning();

      if (!updatedSession) {
        throw new Error("Unable to update upload session");
      }

      return {
        upload: toUploadView(updatedSession, node, options.chunkSizeBytes),

        readyForFinalization: completed,
      };
    });
  }

  async function assertReadyForFinalization(
    ownerId: string,
    uploadId: string,
  ): Promise<UploadSessionView> {
    const result = await findOwnedUpload(ownerId, uploadId);

    if (!result) {
      throw new UploadNotFoundError();
    }

    const { session, node } = result;

    if (session.status === "completed") {
      return toUploadView(session, node, options.chunkSizeBytes);
    }

    if (
      session.status !== "processing" ||
      session.receivedSize !== session.expectedSize
    ) {
      throw new UploadStateError("Upload ještě není připravený k finalizaci.");
    }

    return toUploadView(session, node, options.chunkSizeBytes);
  }

  async function cancelUpload(
    ownerId: string,
    uploadId: string,
  ): Promise<void> {
    const result = await db.transaction(async (transaction) => {
      await transaction.execute(
        sql`
              SELECT
                pg_advisory_xact_lock(
                  hashtext(
                    ${uploadId}
                  )
                )
            `,
      );

      const [upload] = await transaction
        .select({
          session: uploadSessions,

          node: driveNodes,
        })
        .from(uploadSessions)
        .innerJoin(
          driveNodes,

          eq(driveNodes.id, uploadSessions.nodeId),
        )
        .where(
          and(
            eq(uploadSessions.id, uploadId),

            eq(uploadSessions.ownerId, ownerId),
          ),
        )
        .limit(1);

      if (!upload) {
        throw new UploadNotFoundError();
      }

      if (upload.session.status === "completed") {
        throw new UploadStateError("Dokončený upload už nelze zrušit.");
      }

      await transaction.insert(auditLogs).values({
        actorUserId: ownerId,

        event: "file.upload_cancelled",

        metadata: {
          uploadId,

          nodeId: upload.node.id,

          name: upload.node.name,
        },
      });

      /*
       * Smazání node odstraní
       * přes CASCADE také
       * file entry a upload session.
       */
      await transaction.delete(driveNodes).where(
        and(
          eq(driveNodes.id, upload.node.id),

          eq(driveNodes.ownerId, ownerId),
        ),
      );

      return upload.session;
    });

    await removeStoredObject(
      options.storagePath,

      getTemporaryUploadKey(result.id),
    );
  }

  async function getReadyFile(ownerId: string, nodeId: string) {
    const [result] = await db
      .select({
        node: driveNodes,

        file: fileEntries,

        blob: blobs,
      })
      .from(driveNodes)
      .innerJoin(
        fileEntries,

        eq(fileEntries.nodeId, driveNodes.id),
      )
      .innerJoin(
        blobs,

        eq(blobs.id, fileEntries.blobId),
      )
      .where(
        and(
          eq(driveNodes.id, nodeId),

          eq(driveNodes.ownerId, ownerId),

          eq(driveNodes.kind, "file"),

          eq(fileEntries.status, "ready"),
        ),
      )
      .limit(1);

    if (!result) {
      throw new UploadNotFoundError();
    }

    return {
      nodeId: result.node.id,

      name: result.node.name,

      mimeType: result.file.mimeType,

      sizeBytes: result.blob.sizeBytes,

      storageKey: result.blob.storageKey,

      checksumSha256: result.blob.checksumSha256,
    };
  }

  async function getFilePreview(ownerId: string, nodeId: string) {
    const [result] = await db
      .select({
        node: driveNodes,

        file: fileEntries,
      })
      .from(driveNodes)
      .innerJoin(
        fileEntries,

        eq(fileEntries.nodeId, driveNodes.id),
      )
      .where(
        and(
          eq(driveNodes.id, nodeId),

          eq(driveNodes.ownerId, ownerId),

          eq(driveNodes.kind, "file"),

          eq(fileEntries.status, "ready"),

          eq(fileEntries.previewStatus, "ready"),
        ),
      )
      .limit(1);

    if (!result || !result.file.previewKey) {
      throw new UploadNotFoundError();
    }

    return {
      nodeId: result.node.id,

      name: result.node.name,

      storageKey: result.file.previewKey,

      mimeType: result.file.previewMimeType ?? "image/webp",
    };
  }

  return {
    appendChunk,
    assertReadyForFinalization,
    cancelUpload,
    createUpload,
    getFilePreview,
    getReadyFile,
    getUpload,
  };
}

export type UploadService = ReturnType<typeof createUploadService>;
