import type { FastifyInstance, FastifyReply } from "fastify";

import { z } from "zod";

import { createStoredReadStream, statStoredObject } from "@picloud/storage";

import type { RequireAuthHandler } from "../auth/require-auth";

import {
  UploadNotFoundError,
  type UploadService,
} from "../uploads/upload-service";

type RouteApp = FastifyInstance<any, any, any, any>;

const fileIdParamsSchema = z.object({
  fileId: z.string().uuid(),
});

function sendPreviewError(reply: FastifyReply, error: unknown) {
  if (error instanceof UploadNotFoundError) {
    return reply.code(404).send({
      error: "preview_not_found",

      message: "Náhled není dostupný",
    });
  }

  throw error;
}

export async function registerPreviewRoutes(
  app: RouteApp,

  options: {
    upload: UploadService;

    requireAuth: RequireAuthHandler;

    storagePath: string;
  },
) {
  app.get(
    "/drive/files/:fileId/preview",

    {
      preHandler: options.requireAuth,
    },

    async (request, reply) => {
      const parsed = fileIdParamsSchema.safeParse(request.params);

      if (!parsed.success) {
        return reply.code(400).send({
          error: "validation_error",

          message: "ID souboru není platné",
        });
      }

      try {
        const preview = await options.upload.getFilePreview(
          request.authUser!.id,

          parsed.data.fileId,
        );

        const previewStat = await statStoredObject(
          options.storagePath,

          preview.storageKey,
        );

        reply
          .header(
            "Content-Type",

            preview.mimeType,
          )
          .header(
            "Content-Length",

            previewStat.size.toString(),
          )
          .header("X-Content-Type-Options", "nosniff")
          .header("Cache-Control", "private, max-age=3600");

        return reply.send(
          createStoredReadStream(
            options.storagePath,

            preview.storageKey,
          ),
        );
      } catch (error) {
        return sendPreviewError(reply, error);
      }
    },
  );
}
