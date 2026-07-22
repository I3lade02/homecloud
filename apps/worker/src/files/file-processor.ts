import { spawn } from "node:child_process";

import { mkdir, rm } from "node:fs/promises";

import { dirname } from "node:path";

import { and, eq, inArray } from "drizzle-orm";

import sharp from "sharp";

import {
  blobs,
  driveNodes,
  fileEntries,
  type Database,
} from "@picloud/database";

import {
  getPreviewStorageKey,
  removeStoredObject,
  resolveStoragePath,
} from "@picloud/storage";

type MetadataValue = string | number | boolean | null;

type FileMetadata = Record<string, MetadataValue>;

const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
  "image/tiff",
  "image/heic",
  "image/heif",
]);

function toErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unknown file processing error";
}

function runCommand(
  command: string,
  arguments_: string[],
): Promise<{
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const process = spawn(command, arguments_, {
      shell: false,

      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    process.stdout.setEncoding("utf8");

    process.stderr.setEncoding("utf8");

    process.stdout.on("data", (chunk: string) => {
      stderr += chunk;
    });

    process.on("error", reject);

    process.on("close", (exitCode) => {
      if (exitCode !== 0) {
        reject(new Error(`${command} skončil kódem ${exitCode}: ${stderr}`));

        return;
      }

      resolve({
        stdout,
        stderr,
      });
    });
  });
}

function parsedPdfPageCount(pdfInfoOutput: string): number | null {
  const match = pdfInfoOutput.match(/^Page:\s+(\d+)$/im);

  if (!match?.[1]) {
    return null;
  }

  const value = Number(match[1]);

  return Number.isSafeInteger(value) ? value : null;
}

async function createImagePreview(
  inputPath: string,
  outputPath: string,
): Promise<FileMetadata> {
  /**
   * Metadata se čtou přímo
   * z hlavičky souboru
   */
  const metadata = await sharp(
    inputPath,

    {
      sequentialRead: true,

      /**
       * Ochrana proti extrémně
       * velkým obrázkům
       *
       */

      limitInputPixels: 100_000_000,
    },
  ).metadata();

  const orientDimensions = metadata.autoOrient;

  await sharp(
    inputPath,

    {
      sequentialRead: true,

      limitInputPixels: 100_000_000,
    },
  )
    .autoOrient()
    .resize({
      width: 720,

      height: 720,

      fit: "inside",

      withoutEnlargement: true,
    })
    .webp({
      quality: 82,

      effort: 4,
    })
    .toFile(outputPath);

  return {
    kind: "image",

    format: metadata.format ?? null,

    mediaType: metadata.mediaType ?? null,

    width: orientDimensions?.width ?? metadata.width ?? null,

    height: orientDimensions?.height ?? metadata.height ?? null,

    pages: metadata.pages ?? 1,

    orientation: metadata.orientation ?? null,

    hasAlpha: metadata.hasAlpha ?? false,

    colourSpace: metadata.space ?? null,

    density: metadata.density ?? null,
  };
}

async function createPdfPreview(
  inputPath: string,
  outputPath: string,
  temporaryOutputBase: string,
): Promise<FileMetadata> {
  const { stdout } = await runCommand(
    "pdfinfo",

    [inputPath],
  );

  const pageCount = parsedPdfPageCount(stdout);

  /**
   * pdftoppm doplní příponu .png
   */

  const temporaryPngPath = `${temporaryOutputBase}.png`;

  try {
    await runCommand(
      "pdftoppm",

      [
        "-f",
        "1",

        "-l",
        "1",

        "-singleFile",

        "-scale-to",
        "1200",

        "-png",

        inputPath,

        temporaryOutputBase,
      ],
    );

    await sharp(
      temporaryPngPath,

      {
        sequentialRead: true,

        limitInputPixels: 100_000_000,
      },
    )
      .resize({
        width: 720,

        height: 720,

        fit: "inside",

        withoutEnlargement: true,
      })
      .webp({
        quality: 82,

        effort: 4,
      })
      .toFile(outputPath);
  } finally {
    await rm(
      temporaryPngPath,

      {
        force: true,
      },
    );
  }

  return {
    kind: "pdf",

    pages: pageCount,

    format: "pdf",
  };
}

export function createFileProcessor(db: Database, storagePath: string) {
  async function processFile(nodeId: string): Promise<void> {
    /**
     * Aotmicky si soubor
     * převezme pouze jeden worker
     */
    const [claimedFile] = await db
      .update(fileEntries)
      .set({
        previewStatus: "processing",

        previewError: null,

        updatedAt: new Date(),
      })
      .where(
        and(
          eq(fileEntries.status, "ready"),

          inArray(
            fileEntries.previewStatus,

            ["pending", "failed"],
          ),
        ),
      )

      .returning({
        nodeId: fileEntries.nodeId,
      });

    /**
     * soubor už mohl být
     * zpracovaný jiným jobem
     */

    if (!claimedFile) {
      return;
    }

    const previewKey = getPreviewStorageKey(nodeId);

    const previewPath = resolveStoragePath(storagePath, previewKey);

    try {
      const [result] = await db
        .select({
          node: driveNodes,

          file: fileEntries,

          blob: blobs,
        })
        .from(driveNodes)
        .innerJoin(
          fileEntries,

          eq(fileEntries, driveNodes.id),
        )
        .innerJoin(
          blobs,

          eq(blobs.id, fileEntries.blobId),
        )
        .where(
          and(
            eq(driveNodes.id, nodeId),

            eq(driveNodes.kind, "file"),

            eq(fileEntries.status, "ready"),
          ),
        )
        .limit(1);

      if (!result) {
        throw new Error("Soubor nebo jeho blob nebyl nalezen");
      }

      const inputPath = resolveStoragePath(
        storagePath,

        result.blob.storageKey,
      );

      await mkdir(
        dirname(previewPath),

        {
          recursive: true,
        },
      );

      let metadata: FileMetadata;

      if (SUPPORTED_IMAGE_TYPES.has(result.file.mimeType)) {
        metadata = await createImagePreview(inputPath, previewPath);
      } else if (result.file.mimeType === "application/pdf") {
        const temporaryOutputBase = resolveStoragePath(
          storagePath,

          `temporary/pdf-preview-${nodeId}`,
        );

        metadata = await createPdfPreview(
          inputPath,
          previewPath,
          temporaryOutputBase,
        );
      } else {
        await db
          .update(fileEntries)
          .set({
            metadata: {
              kind: "other",
            },

            previewStatus: "unsupported",

            previewKey: null,

            previewMimeType: null,

            previewError: null,

            processedAt: new Date(),

            updatedAt: new Date(),
          })
          .where(eq(fileEntries.nodeId, nodeId));

        return;
      }

      const now = new Date();

      await db
        .update(fileEntries)
        .set({
          metadata,

          previewStatus: "ready",

          previewKey,

          previewMimeType: "image/webp",

          previewError: null,

          processedAt: now,

          updatedAt: now,
        })
        .where(eq(fileEntries.nodeId, nodeId));
    } catch (error) {
      await removeStoredObject(storagePath, previewKey);

      const message = toErrorMessage(error);

      await db
        .update(fileEntries)
        .set({
          previewStatus: "failed",

          previewKey: null,

          previewMimeType: null,

          previewError: message.slice(0, 1_000),

          updatedAt: new Date(),
        })
        .where(eq(fileEntries.nodeId, nodeId));

      throw error;
    }
  }

  return {
    processFile,
  };
}
