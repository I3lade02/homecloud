"use client";

import { useRef, useState } from "react";

import { useRouter } from "next/navigation";

import type { ChangeEvent } from "react";

import type {
  UploadSessionResponse,
  UploadSessionView,
} from "@picloud/contracts";

interface UploadItem {
  key: string;
  name: string;
  progress: number;

  status: "preparing" | "uploading" | "processing" | "completed" | "failed";

  message: string | null;
}

interface ApiError {
  message?: string;
}

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export function UploadPanel({ folderId }: { folderId: string }) {
  const router = useRouter();

  const inputRef = useRef<HTMLInputElement>(null);

  const [uploads, setUploads] = useState<UploadItem[]>([]);

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

  function updateUpload(
    key: string,

    update: Partial<UploadItem>,
  ) {
    setUploads((current) =>
      current.map((item) =>
        item.key === key
          ? {
              ...item,
              ...update,
            }
          : item,
      ),
    );
  }

  function getFingerprint(file: File): string {
    return [folderId, file.name, file.size, file.lastModified].join(":");
  }

  function getLocalStorageKey(fingerprint: string): string {
    return `picloud-upload:${fingerprint}`;
  }

  async function readApiError(response: Response): Promise<string> {
    const payload = (await response.json().catch(() => ({}))) as ApiError;

    return payload.message ?? "Upload se nepodařilo dokončit.";
  }

  async function getUpload(uploadId: string): Promise<UploadSessionView> {
    const response = await fetch(
      `${apiUrl}/uploads/${uploadId}`,

      {
        credentials: "include",
      },
    );

    if (!response.ok) {
      throw new Error(await readApiError(response));
    }

    const payload = (await response.json()) as UploadSessionResponse;

    return payload.upload;
  }

  async function createUpload(file: File): Promise<UploadSessionView> {
    const response = await fetch(
      `${apiUrl}/uploads`,

      {
        method: "POST",

        credentials: "include",

        headers: {
          "content-type": "application/json",
        },

        body: JSON.stringify({
          parentId: folderId,

          name: file.name,

          sizeBytes: file.size.toString(),

          mimeType: file.type || "application/octet-stream",
        }),
      },
    );

    if (!response.ok) {
      throw new Error(await readApiError(response));
    }

    const payload = (await response.json()) as UploadSessionResponse;

    return payload.upload;
  }

  async function getOrCreateUpload(
    file: File,
    fingerprint: string,
  ): Promise<UploadSessionView> {
    const storageKey = getLocalStorageKey(fingerprint);

    const existingId = window.localStorage.getItem(storageKey);

    if (existingId) {
      try {
        const existing = await getUpload(existingId);

        if (
          existing.name === file.name &&
          existing.expectedSizeBytes === file.size.toString() &&
          existing.status !== "failed" &&
          existing.status !== "cancelled"
        ) {
          return existing;
        }
      } catch {
        /*
         * Session už neexistuje.
         */
      }

      window.localStorage.removeItem(storageKey);
    }

    const created = await createUpload(file);

    window.localStorage.setItem(storageKey, created.id);

    return created;
  }

  function sendChunk(input: {
    uploadId: string;

    offset: number;

    chunk: Blob;

    totalSize: number;

    itemKey: string;
  }): Promise<number> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.open(
        "PATCH",

        `${apiUrl}/uploads/${input.uploadId}`,
      );

      xhr.withCredentials = true;

      xhr.setRequestHeader(
        "Content-Type",

        "application/offset+octet-stream",
      );

      xhr.setRequestHeader(
        "Upload-Offset",

        input.offset.toString(),
      );

      xhr.upload.addEventListener(
        "progress",

        (event) => {
          if (!event.lengthComputable) {
            return;
          }

          const uploaded = input.offset + event.loaded;

          const progress =
            input.totalSize === 0
              ? 100
              : Math.min(
                  100,

                  Math.round((uploaded / input.totalSize) * 100),
                );

          updateUpload(
            input.itemKey,

            {
              progress,

              status: "uploading",
            },
          );
        },
      );

      xhr.addEventListener(
        "load",

        () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            const newOffset = xhr.getResponseHeader("Upload-Offset");

            if (!newOffset || !/^\d+$/.test(newOffset)) {
              reject(new Error("Server nevrátil nový upload offset."));

              return;
            }

            resolve(Number(newOffset));

            return;
          }

          let message = "Chunk se nepodařilo odeslat.";

          try {
            const payload = JSON.parse(xhr.responseText) as ApiError;

            message = payload.message ?? message;
          } catch {
            // Response nemusela být JSON.
          }

          reject(new Error(message));
        },
      );

      xhr.addEventListener(
        "error",

        () => {
          reject(new Error("Síťové spojení během uploadu selhalo."));
        },
      );

      xhr.addEventListener(
        "abort",

        () => {
          reject(new Error("Upload byl přerušen."));
        },
      );

      xhr.send(input.chunk);
    });
  }

  async function finalizeUpload(uploadId: string): Promise<void> {
    const response = await fetch(
      `${apiUrl}/uploads/${uploadId}/finalize`,

      {
        method: "POST",

        credentials: "include",
      },
    );

    if (!response.ok) {
      throw new Error(await readApiError(response));
    }
  }

  async function waitForFinalization(
    uploadId: string,
    itemKey: string,
  ): Promise<UploadSessionView> {
    updateUpload(
      itemKey,

      {
        status: "processing",

        progress: 100,
      },
    );

    /*
     * Maximálně přibližně
     * pět minut.
     */
    for (let attempt = 0; attempt < 600; attempt += 1) {
      const upload = await getUpload(uploadId);

      if (upload.status === "completed") {
        return upload;
      }

      if (upload.status === "failed") {
        throw new Error(upload.errorMessage ?? "Zpracování souboru selhalo.");
      }

      await sleep(500);
    }

    throw new Error("Zpracování souboru trvá neobvykle dlouho.");
  }

  async function uploadFile(file: File): Promise<void> {
    const fingerprint = getFingerprint(file);

    const itemKey = `${fingerprint}:${crypto.randomUUID()}`;

    setUploads((current) => [
      ...current,

      {
        key: itemKey,

        name: file.name,

        progress: 0,

        status: "preparing",

        message: null,
      },
    ]);

    const storageKey = getLocalStorageKey(fingerprint);

    try {
      let upload = await getOrCreateUpload(file, fingerprint);

      if (upload.status === "completed") {
        updateUpload(
          itemKey,

          {
            progress: 100,

            status: "completed",
          },
        );

        window.localStorage.removeItem(storageKey);

        router.refresh();

        return;
      }

      let offset = Number(upload.receivedSizeBytes);

      updateUpload(
        itemKey,

        {
          progress:
            file.size === 0 ? 100 : Math.round((offset / file.size) * 100),

          status: upload.status === "processing" ? "processing" : "uploading",
        },
      );

      while (offset < file.size) {
        const end = Math.min(
          offset + upload.chunkSizeBytes,

          file.size,
        );

        const chunk = file.slice(offset, end);

        let uploaded = false;

        /*
         * Krátký síťový výpadek
         * třikrát automaticky
         * obnovíme.
         */
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            offset = await sendChunk({
              uploadId: upload.id,

              offset,

              chunk,

              totalSize: file.size,

              itemKey,
            });

            uploaded = true;

            break;
          } catch (chunkError) {
            /*
             * Server mohl chunk
             * přijmout, ale odpověď
             * se cestou ztratila.
             *
             * Načteme proto
             * skutečný offset.
             */
            upload = await getUpload(upload.id);

            const remoteOffset = Number(upload.receivedSizeBytes);

            if (remoteOffset > offset) {
              offset = remoteOffset;

              uploaded = true;

              break;
            }

            if (attempt === 2) {
              throw chunkError;
            }

            await sleep(1_000 * (attempt + 1));
          }
        }

        if (!uploaded) {
          throw new Error("Chunk se nepodařilo nahrát.");
        }

        upload = await getUpload(upload.id);
      }

      await finalizeUpload(upload.id);

      await waitForFinalization(upload.id, itemKey);

      window.localStorage.removeItem(storageKey);

      updateUpload(
        itemKey,

        {
          progress: 100,

          status: "completed",

          message: "Hotovo",
        },
      );

      router.refresh();
    } catch (error) {
      updateUpload(
        itemKey,

        {
          status: "failed",

          message: error instanceof Error ? error.message : "Upload selhal.",
        },
      );
    }
  }

  function selectFiles() {
    inputRef.current?.click();
  }

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);

    /*
     * Umožní zvolit stejný
     * soubor znovu.
     */
    event.target.value = "";

    for (const file of files) {
      void uploadFile(file);
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        className="upload-input"
        type="file"
        multiple
        onChange={handleFiles}
      />

      <button
        className={"button button--secondary"}
        type="button"
        onClick={selectFiles}
      >
        Nahrát soubory
      </button>

      {uploads.length > 0 ? (
        <aside className="upload-drawer">
          <div className="upload-drawer__heading">
            <strong>Přenosy</strong>

            <button
              type="button"
              onClick={() =>
                setUploads((current) =>
                  current.filter(
                    (upload) =>
                      upload.status !== "completed" &&
                      upload.status !== "failed",
                  ),
                )
              }
            >
              Vyčistit hotové
            </button>
          </div>

          <div className="upload-list">
            {uploads.map((upload) => (
              <article className="upload-item" key={upload.key}>
                <div className="upload-item__top">
                  <strong>{upload.name}</strong>

                  <span>
                    {upload.status === "preparing"
                      ? "Příprava"
                      : upload.status === "uploading"
                        ? `${upload.progress} %`
                        : upload.status === "processing"
                          ? "Zpracování"
                          : upload.status === "completed"
                            ? "Hotovo"
                            : "Chyba"}
                  </span>
                </div>

                <div className="upload-progress">
                  <span
                    style={{
                      width: `${upload.progress}%`,
                    }}
                  />
                </div>

                {upload.message ? <p>{upload.message}</p> : null}
              </article>
            ))}
          </div>
        </aside>
      ) : null}
    </>
  );
}
