"use client";

import Link from "next/link";

import {
  useRouter,
} from "next/navigation";

import {
  useState,
  type FormEvent,
} from "react";

import type {
  DriveFolderOption,
  DriveFolderOptionsResponse,
  DriveFolderView,
  DriveNode,
} from "@picloud/contracts";

type DialogState =
  | {
      type: "create";
    }
  | {
      type: "rename";
      node: DriveNode;
    }
  | {
      type: "move";
      node: DriveNode;
    }
  | null;

interface ApiError {
  message?: string;
}

function folderHref(
  id: string,
  isRoot: boolean,
): string {
  return isRoot
    ? "/files"
    : `/files/${id}`;
}

function formatBytes(
  value: string,
): string {
  const bytes =
    Number(value);

  if (
    !Number.isFinite(bytes) ||
    bytes <= 0
  ) {
    return "0 B";
  }

  const units = [
    "B",
    "KB",
    "MB",
    "GB",
    "TB",
  ];

  const unitIndex =
    Math.min(
      Math.floor(
        Math.log(bytes) /
          Math.log(1024),
      ),

      units.length - 1,
    );

  const amount =
    bytes /
    1024 ** unitIndex;

  return `${
    amount.toFixed(
      amount >= 10 ||
      unitIndex === 0
        ? 0
        : 1,
    )
  } ${units[unitIndex]}`;
}

export function FileManager({
  view,
}: {
  view: DriveFolderView;
}) {
  const router =
    useRouter();

  const [
    dialog,
    setDialog,
  ] = useState<
    DialogState
  >(null);

  const [
    name,
    setName,
  ] = useState("");

  const [
    targetParentId,
    setTargetParentId,
  ] = useState("");

  const [
    folderOptions,
    setFolderOptions,
  ] = useState<
    DriveFolderOption[]
  >([]);

  const [
    error,
    setError,
  ] = useState<
    string | null
  >(null);

  const [
    busy,
    setBusy,
  ] = useState(false);

  const apiUrl =
    process.env
      .NEXT_PUBLIC_API_URL ??
    "http://localhost:4000";

  function closeDialog() {
    if (busy) {
      return;
    }

    setDialog(null);
    setError(null);
    setName("");
    setTargetParentId("");
  }

  function openCreateDialog() {
    setError(null);
    setName("");

    setDialog({
      type:
        "create",
    });
  }

  function openRenameDialog(
    node: DriveNode,
  ) {
    setError(null);
    setName(node.name);

    setDialog({
      type:
        "rename",

      node,
    });
  }

  async function openMoveDialog(
    node: DriveNode,
  ) {
    setError(null);
    setBusy(true);

    try {
      const response =
        await fetch(
          `${apiUrl}/drive/folders`,

          {
            credentials:
              "include",
          },
        );

      if (!response.ok) {
        throw new Error(
          "Nepodařilo se načíst cílové složky.",
        );
      }

      const payload =
        await response
          .json() as
          DriveFolderOptionsResponse;

      setFolderOptions(
        payload.folders,
      );

      setTargetParentId(
        node.parentId ?? "",
      );

      setDialog({
        type:
          "move",

        node,
      });
    } catch (caughtError) {
      setError(
        caughtError instanceof
          Error
          ? caughtError.message
          : "Nepodařilo se připravit přesunutí.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function sendMutation(
    path: string,

    method:
      | "POST"
      | "PATCH",

    body:
      Record<
        string,
        string
      >,
  ) {
    const response =
      await fetch(
        `${apiUrl}${path}`,

        {
          method,

          credentials:
            "include",

          headers: {
            "content-type":
              "application/json",
          },

          body:
            JSON.stringify(
              body,
            ),
        },
      );

    if (!response.ok) {
      const payload =
        await response
          .json()
          .catch(
            () => ({}),
          ) as ApiError;

      throw new Error(
        payload.message ??
          "Operaci se nepodařilo dokončit.",
      );
    }
  }

  async function submitDialog(
    event:
      FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!dialog) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      if (
        dialog.type ===
        "create"
      ) {
        await sendMutation(
          "/drive/folders",

          "POST",

          {
            parentId:
              view.folder.id,

            name,
          },
        );
      }

      if (
        dialog.type ===
        "rename"
      ) {
        await sendMutation(
          `/drive/folders/${
            dialog.node.id
          }`,

          "PATCH",

          {
            name,
          },
        );
      }

      if (
        dialog.type ===
        "move"
      ) {
        await sendMutation(
          `/drive/folders/${
            dialog.node.id
          }/move`,

          "POST",

          {
            parentId:
              targetParentId,
          },
        );
      }

      setDialog(null);
      setName("");
      setTargetParentId("");

      router.refresh();
    } catch (caughtError) {
      setError(
        caughtError instanceof
          Error
          ? caughtError.message
          : "Operaci se nepodařilo dokončit.",
      );
    } finally {
      setBusy(false);
    }
  }

  const moveDestinations =
    dialog?.type === "move"
      ? folderOptions.filter(
          (folder) =>
            folder.id !==
            dialog.node.id,
        )
      : [];

  return (
    <main className="drive-shell">
      <header className="drive-topbar">
        <Link
          className="brand"
          href="/"
        >
          <span
            className="brand-mark"
            aria-hidden="true"
          >
            ☁
          </span>

          <span>PiCloud</span>
        </Link>

        <button
          className={
            "button button--primary"
          }
          type="button"
          onClick={
            openCreateDialog
          }
        >
          + Nová složka
        </button>
      </header>

      <section className="drive-heading">
        <nav
          className="breadcrumbs"
          aria-label="Cesta ke složce"
        >
          {view.breadcrumbs.map(
            (
              breadcrumb,
              index,
            ) => (
              <span
                key={
                  breadcrumb.id
                }
              >
                {index > 0 ? (
                  <span className="breadcrumbs__separator">
                    /
                  </span>
                ) : null}

                <Link
                  href={
                    folderHref(
                      breadcrumb.id,
                      breadcrumb.isRoot,
                    )
                  }
                >
                  {breadcrumb.name}
                </Link>
              </span>
            ),
          )}
        </nav>

        <div>
          <p className="eyebrow">
            Moje soubory
          </p>

          <h1>
            {view.folder.name}
          </h1>

          <p className="drive-heading__meta">
            {view.children
              .length === 0
              ? "Prázdná složka"
              : `${
                  view.children
                    .length
                } položek`}
          </p>
        </div>
      </section>

      {view.children
        .length === 0 ? (
        <section className="drive-empty">
          <span aria-hidden="true">
            📂
          </span>

          <h2>
            Tady je zatím ticho.
          </h2>

          <p>
            Vytvoř první složku.
            Upload souborů dorazí
            v příštím milníku.
          </p>

          <button
            className={
              "button button--primary"
            }
            type="button"
            onClick={
              openCreateDialog
            }
          >
            Vytvořit složku
          </button>
        </section>
      ) : (
        <section
          className="drive-grid"
          aria-label="Obsah složky"
        >
          {view.children.map(
            (node) => {
              const content = (
                <>
                  <span
                    className={
                      "drive-card__icon"
                    }
                    aria-hidden="true"
                  >
                    {node.kind ===
                    "folder"
                      ? "📁"
                      : "📄"}
                  </span>

                  <span className="drive-card__name">
                    {node.name}
                  </span>

                  <span className="drive-card__meta">
                    {node.kind ===
                    "folder"
                      ? "Složka"
                      : node.file
                        ? formatBytes(
                            node.file
                              .sizeBytes,
                          )
                        : "Soubor"}
                  </span>
                </>
              );

              return (
                <article
                  className="drive-card"
                  key={node.id}
                >
                  {node.kind ===
                  "folder" ? (
                    <Link
                      className={
                        "drive-card__main"
                      }
                      href={
                        folderHref(
                          node.id,
                          false,
                        )
                      }
                    >
                      {content}
                    </Link>
                  ) : (
                    <div className="drive-card__main">
                      {content}
                    </div>
                  )}

                  {node.kind ===
                  "folder" ? (
                    <div className="drive-card__actions">
                      <button
                        type="button"
                        onClick={() =>
                          openRenameDialog(
                            node,
                          )
                        }
                      >
                        Přejmenovat
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          void openMoveDialog(
                            node,
                          )
                        }
                      >
                        Přesunout
                      </button>
                    </div>
                  ) : null}
                </article>
              );
            },
          )}
        </section>
      )}

      {error && !dialog ? (
        <p className="drive-toast">
          {error}
        </p>
      ) : null}

      {dialog ? (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={
            closeDialog
          }
        >
          <section
            className="drive-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={
              "drive-dialog-title"
            }
            onMouseDown={(
              event,
            ) =>
              event
                .stopPropagation()
            }
          >
            <p className="eyebrow">
              {dialog.type ===
              "create"
                ? "Nová složka"
                : dialog.type ===
                    "rename"
                  ? "Přejmenovat"
                  : "Přesunout"}
            </p>

            <h2 id="drive-dialog-title">
              {dialog.type ===
              "create"
                ? `Uvnitř „${
                    view.folder.name
                  }“`
                : dialog.node.name}
            </h2>

            <form
              className={
                "drive-dialog__form"
              }
              onSubmit={
                submitDialog
              }
            >
              {dialog.type ===
              "move" ? (
                <label>
                  <span>
                    Cílová složka
                  </span>

                  <select
                    value={
                      targetParentId
                    }
                    onChange={(
                      event,
                    ) =>
                      setTargetParentId(
                        event.target
                          .value,
                      )
                    }
                    required
                    autoFocus
                  >
                    <option
                      value=""
                      disabled
                    >
                      Vyber cílovou
                      složku
                    </option>

                    {moveDestinations
                      .map(
                        (
                          folder,
                        ) => (
                          <option
                            key={
                              folder.id
                            }
                            value={
                              folder.id
                            }
                          >
                            {
                              folder.path
                            }
                          </option>
                        ),
                      )}
                  </select>
                </label>
              ) : (
                <label>
                  <span>
                    Název
                  </span>

                  <input
                    value={name}
                    onChange={(
                      event,
                    ) =>
                      setName(
                        event.target
                          .value,
                      )
                    }
                    minLength={1}
                    maxLength={255}
                    required
                    autoFocus
                  />
                </label>
              )}

              {error ? (
                <p className="auth-error">
                  {error}
                </p>
              ) : null}

              <div className="drive-dialog__actions">
                <button
                  className={
                    "button button--secondary"
                  }
                  type="button"
                  onClick={
                    closeDialog
                  }
                >
                  Zrušit
                </button>

                <button
                  className={
                    "button button--primary"
                  }
                  disabled={busy}
                >
                  {busy
                    ? "Pracuji…"
                    : dialog.type ===
                        "create"
                      ? "Vytvořit"
                      : dialog.type ===
                          "rename"
                        ? "Uložit název"
                        : "Přesunout"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </main>
  );
}