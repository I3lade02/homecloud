import type { FastifyInstance, FastifyReply } from "fastify";

import { z } from "zod";

import { createStoredReadStream } from "@picloud/storage";

import type { RequireAuthHandler } from "../auth/require-auth";

import {
  UploadNotFoundError,
  type UploadService,
} from "../uploads/upload-service";

type RouteApp = FastifyInstance<any, any, any, any>;

const fileIdParamsSchema = z.object({
  fileId: z.string().uuid(),
});

const fileQuerySchema = z.object({
  download: z.enum(["0", "1"]).optional(),
});

interface ByteRange {
  start: bigint;
  end: bigint;
}

function parseRange(
  header: string | undefined,

  size: bigint,
): ByteRange | null | "invalid" {
  if (!header) {
    return null;
  }

  if (!header.startsWith("bytes=") || header.includes(",")) {
    return "invalid";
  }

  const range = header.slice("bytes=".length);

  const [startText = "", endText = ""] = range.split("-");

  if (!startText && !endText) {
    return "invalid";
  }

  if (!startText) {
    if (!/^\d+$/.test(endText)) {
      return "invalid";
    }

    const suffixLength = BigInt(endText);

    if (suffixLength <= 0n || size <= 0n) {
      return "invalid";
    }

    return {
      start: suffixLength >= size ? 0n : size - suffixLength,

      end: size - 1n,
    };
  }

  if (!/^\d+$/.test(startText) || (endText && !/^\d+$/.test(endText))) {
    return "invalid";
  }

  const start = BigInt(startText);

  const end = endText ? BigInt(endText) : size - 1n;

  if (start < 0n || end < start || start >= size) {
    return "invalid";
  }

  return {
    start,

    end: end >= size ? size - 1n : end,
  };
}

function encodeContentDisposition(fileName: string, download: boolean): string {
  const disposition = download ? "attachment" : "inline";

  const fallback = fileName
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "_");

  const encoded = encodeURIComponent(fileName).replace(
    /['()]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return [
    disposition,
    `filename="${fallback}"`,
    `filename*=UTF-8''${encoded}`,
  ].join("; ");
}

function sendFileError(reply: FastifyReply, error: unknown) {
  if (error instanceof UploadNotFoundError) {
    return reply.code(404).send({
      error: "file_not_found",

      message: "Soubor nebyl nalezen nebo ještě není připravený.",
    });
  }

  throw error;
}

export async function registerFileRoutes(
  app: RouteApp,

  options: {
    upload: UploadService;

    requireAuth: RequireAuthHandler;

    storagePath: string;
  },
) {
  app.get(
    "/drive/files/:fileId/content",

    {
      preHandler: options.requireAuth,
    },

    async (request, reply) => {
      const parsedParams = fileIdParamsSchema.safeParse(request.params);

      const parsedQuery = fileQuerySchema.safeParse(request.query);

      if (!parsedParams.success || !parsedQuery.success) {
        return reply.code(400).send({
          error: "validation_error",

          message: "Požadavek na soubor není platný.",
        });
      }

      try {
        const file = await options.upload.getReadyFile(
          request.authUser!.id,

          parsedParams.data.fileId,
        );

        const range = parseRange(
          typeof request.headers.range === "string"
            ? request.headers.range
            : undefined,

          file.sizeBytes,
        );

        reply
          .header("Accept-Ranges", "bytes")
          .header("X-Content-Type-Options", "nosniff")
          .header("Cache-Control", "private, no-store")
          .header("Content-Type", file.mimeType)
          .header(
            "Content-Disposition",

            encodeContentDisposition(
              file.name,

              parsedQuery.data.download === "1",
            ),
          );

        if (range === "invalid") {
          return reply
            .header(
              "Content-Range",

              `bytes */${file.sizeBytes}`,
            )
            .code(416)
            .send();
        }

        if (range) {
          const contentLength = range.end - range.start + 1n;

          reply
            .header(
              "Content-Range",

              `bytes ${range.start}-${range.end}/${file.sizeBytes}`,
            )
            .header(
              "Content-Length",

              contentLength.toString(),
            )
            .code(206);

          return reply.send(
            createStoredReadStream(
              options.storagePath,
              file.storageKey,

              {
                start: Number(range.start),

                end: Number(range.end),
              },
            ),
          );
        }

        reply.header("Content-Length", file.sizeBytes.toString());

        return reply.send(
          createStoredReadStream(options.storagePath, file.storageKey),
        );
      } catch (error) {
        return sendFileError(reply, error);
      }
    },
  );
}
