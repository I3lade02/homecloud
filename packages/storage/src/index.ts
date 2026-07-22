import { createReadStream } from "node:fs";

import { access, copyFile, link, mkdir, stat, unlink } from "node:fs/promises";

import { constants } from "node:fs";

import { dirname, resolve, sep } from "node:path";

export const STORAGE_DIRECTORIES = [
  "blobs",
  "temporary",
  "thumbnails",
  "exports",
  "quarantine",
] as const;

export interface StoredObjectRange {
  start: number;
  end: number;
}

function isFileSystemError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

export async function ensureStorageLayout(storagePath: string): Promise<void> {
  await mkdir(storagePath, {
    recursive: true,
  });

  await Promise.all(
    STORAGE_DIRECTORIES.map((directory) =>
      mkdir(
        resolve(storagePath, directory),

        {
          recursive: true,
        },
      ),
    ),
  );
}

export async function checkStorage(storagePath: string): Promise<number> {
  const startedAt = performance.now();

  await access(storagePath, constants.R_OK | constants.W_OK);

  return Math.round(performance.now() - startedAt);
}

export function resolveStoragePath(
  storagePath: string,
  storageKey: string,
): string {
  const root = resolve(storagePath);

  const resolvedPath = resolve(root, storageKey);

  if (resolvedPath !== root && !resolvedPath.startsWith(`${root}${sep}`)) {
    throw new Error("Storage key points outside the storage root");
  }

  return resolvedPath;
}

export function getTemporaryUploadKey(uploadId: string): string {
  return `temporary/${uploadId}.part`;
}

export function getBlobStorageKey(checksumSha256: string): string {
  return ["blobs", checksumSha256.slice(0, 2), checksumSha256.slice(2, 4)].join(
    "/",
  );
}

export async function ensureBlobFromTemporary(
  storagePath: string,
  temporaryKey: string,
  blobKey: string,
): Promise<void> {
  const temporaryPath = resolveStoragePath(storagePath, temporaryKey);

  const blobPath = resolveStoragePath(storagePath, blobKey);

  await mkdir(dirname(blobPath), {
    recursive: true,
  });

  try {
    /**
     * Hardlink je atomický
     * a nekopíruje data
     */
    await link(temporaryPath, blobPath);

    return;
  } catch (error) {
    if (isFileSystemError(error) && error.code === "EEXIST") {
      /**
       * Blob se stejným hashem
       * už fyzicky existuje
       */
      return;
    }

    if (
      !isFileSystemError(error) ||
      (error.code !== "EXDEV" &&
        error.code !== "EPERM" &&
        error.code !== "ENOTSUP")
    ) {
      throw error;
    }
  }

  /**
   * Fallback pro filesystémy,
   * kde hardlinky nejsou dostupné
   */
  try {
    await copyFile(temporaryPath, blobPath, constants.COPYFILE_EXCL);
  } catch (error) {
    if (isFileSystemError(error) && error.code === "EEXIST") {
      return;
    }

    throw error;
  }
}

export async function removeStoredObject(
  storagePath: string,
  storageKey: string,
): Promise<void> {
  const objectPath = resolveStoragePath(storagePath, storageKey);

  try {
    await unlink(objectPath);
  } catch (error) {
    if (isFileSystemError(error) && error.code === "ENOENT") {
      return;
    }

    throw error;
  }
}

export async function statStoredObject(
  storagePath: string,
  storageKey: string,
) {
  return stat(resolveStoragePath(storagePath, storageKey));
}

export function createStoredReadStream(
  storagePath: string,
  storageKey: string,
  range?: StoredObjectRange,
) {
  const objectPath = resolveStoragePath(storagePath, storageKey);

  return createReadStream(
    objectPath,
    range
      ? {
          start: range.start,
          end: range.end,
        }
      : undefined,
  );
}

export function getPreviewStorageKey(nodeId: string): string {
  return `thumbnails/${nodeId}.webp`;
}
