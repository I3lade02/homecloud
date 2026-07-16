import { access, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";

export const STORAGE_DIRECTORIES = [
  "blobs",
  "temporary",
  "thumbnails",
  "exports",
  "quarantine",
] as const;

export async function ensureStorageLayout(storagePath: string): Promise<void> {
  await mkdir(storagePath, {
    recursive: true,
  });

  await Promise.all(
    STORAGE_DIRECTORIES.map((directory) =>
      mkdir(join(storagePath, directory), {
        recursive: true,
      }),
    ),
  );
}

export async function checkStorage(storagePath: string): Promise<number> {
  const startedAt = performance.now();

  await access(storagePath, constants.R_OK | constants.W_OK);

  return Math.round(performance.now() - startedAt);
}
