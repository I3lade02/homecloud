import type { Readable } from "node:stream";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { z } from "zod";

import type { RequireAuthHandler } from "../auth/require-auth";

import { DuplicateDriveNameError } from "../drive/drive-service";

import {
  UploadChunkTooLargeError,
  UploadExpiredError,
  UploadNotFoundError,
  UploadOffsetMismatchError,
  UploadSizeLimitError,
  UploadStateError,
  UploadStorageMismatchError,
  type UploadService,
} from "../uploads/upload-service";

type RouteApp = FastifyInstance<any, any, any, any>;

const uploadIdParamsSchema = z.object({
  uploadId: z.string().uuid(),
});

const createUploadSchema = z.object({
  parentId: z.string().uuid(),

  name: z.string().min(1).max(255),

  sizeBytes: z.union([
    z.string().regex(/^\d+$/),

    z.number().int().nonnegative(),
  ]),

  mimeType: z.string().max(255).default("application/octet-stream"),
});

function requestMetadata(request: FastifyRequest) {
  return {
    ipAddress: request.ip,

    userAgent: request.headers["user-agent"],
  };
}

function isReadable(value: unknown): value is Readable {
  return (
    typeof value === "object" &&
    value !== null &&
    "pipe" in value &&
    typeof (
      value as {
        pipe?: unknown;
      }
    ).pipe === "function"
  );
}

function parseUploadOffset(
  value: string | string[] | undefined,
): bigint | null {
  const normalized = Array.isArray(value) ? value[0] : value;

  if (!normalized || !/^\d+$/.test(normalized)) {
    return null;
  }

  return BigInt(normalized);
}

function sendUploadError(reply: FastifyReply, error: unknown) {
  if (error instanceof UploadOffsetMismatchError) {
    return reply
      .header("Upload-Offset", error.expectedOffset.toString())
      .code(409)
      .send({
        error: "upload_offset_mismatch",

        message: error.message,

        expectedOffset: error.expectedOffset.toString(),
      });
  }

  if (error instanceof UploadNotFoundError) {
    return reply.code(404).send({
      error: "upload_not_found",

      message: error.message,
    });
  }

  if (error instanceof DuplicateDriveNameError) {
    return reply.code(409).send({
      error: "duplicate_drive_name",

      message: error.message,
    });
  }

  if (error instanceof UploadSizeLimitError) {
    return reply.code(413).send({
      error: "upload_too_large",

      message: error.message,

      maximumBytes: error.maximumBytes,
    });
  }

  if (
    error instanceof UploadExpiredError ||
    error instanceof UploadStateError ||
    error instanceof UploadChunkTooLargeError ||
    error instanceof UploadStorageMismatchError
  ) {
    return reply.code(409).send({
      error: "invalid_upload_state",

      message: error.message,
    });
  }

  throw error;
}

export async function registerUploadRoutes(
  app: RouteApp,

  options: {
    upload: UploadService;

    requireAuth: RequireAuthHandler;

    enqueueFinalization: (uploadId: string) => Promise<void>;
  },
) {
  app.post(
    "/uploads",

    {
      preHandler: options.requireAuth,
    },

    async (request, reply) => {
      const parsed = createUploadSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({
          error: "validation_error",

          message: "Zkontroluj údaje souboru.",

          issues: parsed.error.flatten().fieldErrors,
        });
      }

      const sizeBytes =
        typeof parsed.data.sizeBytes === "number"
          ? BigInt(parsed.data.sizeBytes)
          : BigInt(parsed.data.sizeBytes);

      try {
        const upload = await options.upload.createUpload({
          ownerId: request.authUser!.id,

          parentId: parsed.data.parentId,

          name: parsed.data.name,

          sizeBytes,

          mimeType: parsed.data.mimeType,

          ...requestMetadata(request),
        });

        return reply.code(201).send({
          upload,
        });
      } catch (error) {
        return sendUploadError(reply, error);
      }
    },
  );

  app.get(
    "/uploads/:uploadId",

    {
      preHandler: options.requireAuth,
    },

    async (request, reply) => {
      const parsed = uploadIdParamsSchema.safeParse(request.params);

      if (!parsed.success) {
        return reply.code(400).send({
          error: "validation_error",

          message: "Upload ID není platné.",
        });
      }

      try {
        const upload = await options.upload.getUpload(
          request.authUser!.id,

          parsed.data.uploadId,
        );

        return reply.send({
          upload,
        });
      } catch (error) {
        return sendUploadError(reply, error);
      }
    },
  );

  app.patch(
    "/uploads/:uploadId",

    /*
     * onRequest proběhne ještě
     * před zpracováním request body.
     */
    {
      onRequest: options.requireAuth,
    },

    async (request, reply) => {
      const parsed = uploadIdParamsSchema.safeParse(request.params);

      const offset = parseUploadOffset(request.headers["upload-offset"]);

      if (!parsed.success || offset === null) {
        return reply.code(400).send({
          error: "validation_error",

          message: "Upload ID nebo Upload-Offset není platný.",
        });
      }

      if (!isReadable(request.body)) {
        return reply.code(415).send({
          error: "invalid_upload_body",

          message: "Očekáván byl binární upload chunk.",
        });
      }

      try {
        const result = await options.upload.appendChunk({
          ownerId: request.authUser!.id,

          uploadId: parsed.data.uploadId,

          offset,

          body: request.body,
        });

        return reply
          .header(
            "Upload-Offset",

            result.upload.receivedSizeBytes,
          )
          .header(
            "Upload-Status",

            result.upload.status,
          )
          .code(204)
          .send();
      } catch (error) {
        /*
         * Pokud handler chunk
         * nepoužil, stream necháme
         * odtéct, aby nezůstal viset.
         */
        request.body.resume();

        return sendUploadError(reply, error);
      }
    },
  );

  app.post(
    "/uploads/:uploadId/finalize",

    {
      preHandler: options.requireAuth,
    },

    async (request, reply) => {
      const parsed = uploadIdParamsSchema.safeParse(request.params);

      if (!parsed.success) {
        return reply.code(400).send({
          error: "validation_error",

          message: "Upload ID není platné.",
        });
      }

      try {
        const upload = await options.upload.assertReadyForFinalization(
          request.authUser!.id,

          parsed.data.uploadId,
        );

        if (upload.status !== "completed") {
          await options.enqueueFinalization(upload.id);
        }

        return reply.code(202).send({
          upload,
        });
      } catch (error) {
        return sendUploadError(reply, error);
      }
    },
  );

  app.delete(
    "/uploads/:uploadId",

    {
      preHandler: options.requireAuth,
    },

    async (request, reply) => {
      const parsed = uploadIdParamsSchema.safeParse(request.params);

      if (!parsed.success) {
        return reply.code(400).send({
          error: "validation_error",

          message: "Upload ID není platné.",
        });
      }

      try {
        await options.upload.cancelUpload(
          request.authUser!.id,

          parsed.data.uploadId,
        );

        return reply.code(204).send();
      } catch (error) {
        return sendUploadError(reply, error);
      }
    },
  );
}
