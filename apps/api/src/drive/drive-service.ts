import {
  and,
  asc,
  eq,
} from "drizzle-orm";

import type {
  DriveBreadcrumb,
  DriveFolderOption,
  DriveFolderView,
  DriveNode,
} from "@picloud/contracts";

import {
  driveNodes,
  fileEntries,
  type Database,
  type DriveNodeRecord,
  type FileEntryRecord,
} from "@picloud/database";

const ROOT_FOLDER_NAME =
  "Moje soubory";

const MAX_TREE_DEPTH =
  256;

/*
 * Doménové chyby
 */

export class DriveNodeNotFoundError
  extends Error {
  constructor() {
    super(
      "Složka nebyla nalezena.",
    );

    this.name =
      "DriveNodeNotFoundError";
  }
}

export class DuplicateDriveNameError
  extends Error {
  constructor() {
    super(
      "V této složce už položka se stejným názvem existuje.",
    );

    this.name =
      "DuplicateDriveNameError";
  }
}

export class InvalidDriveMoveError
  extends Error {
  constructor(
    message =
      "Složku nelze přesunout do zvoleného umístění.",
  ) {
    super(message);

    this.name =
      "InvalidDriveMoveError";
  }
}

export class RootFolderMutationError
  extends Error {
  constructor() {
    super(
      "Kořenovou složku nelze přejmenovat ani přesunout.",
    );

    this.name =
      "RootFolderMutationError";
  }
}

export class InvalidDriveNameError
  extends Error {
  constructor(
    message =
      "Název složky není platný.",
  ) {
    super(message);

    this.name =
      "InvalidDriveNameError";
  }
}

/*
 * Normalizace názvu.
 */

function prepareDriveName(
  value: string,
): {
  name: string;
  normalizedName: string;
} {
  const name = value
    .normalize("NFKC")
    .trim()
    .replace(
      /\s+/g,
      " ",
    );

  if (
    !name ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\0")
  ) {
    throw new InvalidDriveNameError(
      "Název nesmí být prázdný, tečka, dvě tečky ani obsahovat znak /.",
    );
  }

  if (
    name.length > 255
  ) {
    throw new InvalidDriveNameError(
      "Název může mít maximálně 255 znaků.",
    );
  }

  return {
    name,

    normalizedName:
      name.toLowerCase(),
  };
}

function isUniqueViolation(
  error: unknown,
): boolean {
  return (
    typeof error ===
      "object" &&
    error !== null &&
    "code" in error &&
    (
      error as {
        code?: unknown;
      }
    ).code === "23505"
  );
}

/*
 * Převod DB záznamu
 * na veřejný API kontrakt.
 */

function toDriveNode(
  node: DriveNodeRecord,

  file:
    | FileEntryRecord
    | null = null,
): DriveNode {
  return {
    id:
      node.id,

    parentId:
      node.parentId,

    kind:
      node.kind,

    name:
      node.name,

    isRoot:
      node.isRoot,

    createdAt:
      node.createdAt
        .toISOString(),

    updatedAt:
      node.updatedAt
        .toISOString(),

    file:
      file === null
        ? null
        : {
            sizeBytes:
              file.sizeBytes
                .toString(),

            mimeType:
              file.mimeType,

            status:
              file.status,
          },
  };
}

export function createDriveService(
  db: Database,
) {
  async function findOwnedNode(
    ownerId: string,
    nodeId: string,
  ): Promise<
    DriveNodeRecord | null
  > {
    const [node] =
      await db
        .select()
        .from(driveNodes)
        .where(
          and(
            eq(
              driveNodes.id,
              nodeId,
            ),

            eq(
              driveNodes.ownerId,
              ownerId,
            ),
          ),
        )
        .limit(1);

    return node ?? null;
  }

  async function requireOwnedFolder(
    ownerId: string,
    folderId: string,
  ): Promise<DriveNodeRecord> {
    const folder =
      await findOwnedNode(
        ownerId,
        folderId,
      );

    if (
      !folder ||
      folder.kind !== "folder"
    ) {
      throw new DriveNodeNotFoundError();
    }

    return folder;
  }

  /*
   * Idempotentní vytvoření rootu.
   *
   * Pomůže i současnému ownerovi,
   * který vznikl v Milníku 2.
   */

  async function ensureRootFolder(
    ownerId: string,
  ): Promise<DriveNodeRecord> {
    const [existingRoot] =
      await db
        .select()
        .from(driveNodes)
        .where(
          and(
            eq(
              driveNodes.ownerId,
              ownerId,
            ),

            eq(
              driveNodes.isRoot,
              true,
            ),
          ),
        )
        .limit(1);

    if (existingRoot) {
      return existingRoot;
    }

    const preparedName =
      prepareDriveName(
        ROOT_FOLDER_NAME,
      );

    /*
     * Dva současné requesty
     * se mohou pokusit vytvořit
     * root zároveň.
     *
     * Unikátní index dovolí
     * uspět jen jednomu.
     */

    const [createdRoot] =
      await db
        .insert(driveNodes)
        .values({
          ownerId,

          parentId:
            null,

          kind:
            "folder",

          name:
            preparedName.name,

          normalizedName:
            preparedName
              .normalizedName,

          isRoot:
            true,
        })
        .onConflictDoNothing()
        .returning();

    if (createdRoot) {
      return createdRoot;
    }

    const [rootAfterConflict] =
      await db
        .select()
        .from(driveNodes)
        .where(
          and(
            eq(
              driveNodes.ownerId,
              ownerId,
            ),

            eq(
              driveNodes.isRoot,
              true,
            ),
          ),
        )
        .limit(1);

    if (!rootAfterConflict) {
      throw new Error(
        "Nepodařilo se vytvořit kořenovou složku.",
      );
    }

    return rootAfterConflict;
  }

  /*
   * Sestavení breadcrumbs.
   */

  async function buildBreadcrumbs(
    ownerId: string,
    start: DriveNodeRecord,
  ): Promise<
    DriveBreadcrumb[]
  > {
    const breadcrumbs:
      DriveBreadcrumb[] = [];

    let current:
      | DriveNodeRecord
      | null = start;

    let depth = 0;

    while (current) {
      breadcrumbs.push({
        id:
          current.id,

        name:
          current.name,

        isRoot:
          current.isRoot,
      });

      if (current.isRoot) {
        break;
      }

      depth += 1;

      if (
        depth >
          MAX_TREE_DEPTH ||
        !current.parentId
      ) {
        throw new Error(
          "Souborový strom je poškozený.",
        );
      }

      current =
        await findOwnedNode(
          ownerId,
          current.parentId,
        );

      if (!current) {
        throw new Error(
          "Souborový strom obsahuje chybějícího rodiče.",
        );
      }
    }

    return breadcrumbs.reverse();
  }

  async function getFolderView(
    ownerId: string,
    folderId: string,
  ): Promise<DriveFolderView> {
    const folder =
      await requireOwnedFolder(
        ownerId,
        folderId,
      );

    const [
      breadcrumbs,
      childRows,
    ] = await Promise.all([
      buildBreadcrumbs(
        ownerId,
        folder,
      ),

      db
        .select({
          node:
            driveNodes,

          file:
            fileEntries,
        })
        .from(driveNodes)
        .leftJoin(
          fileEntries,

          eq(
            fileEntries.nodeId,
            driveNodes.id,
          ),
        )
        .where(
          and(
            eq(
              driveNodes.ownerId,
              ownerId,
            ),

            eq(
              driveNodes.parentId,
              folder.id,
            ),
          ),
        )
        .orderBy(
          asc(
            driveNodes.kind,
          ),

          asc(
            driveNodes.normalizedName,
          ),
        ),
    ]);

    return {
      folder:
        toDriveNode(folder),

      breadcrumbs,

      children:
        childRows.map(
          ({
            node,
            file,
          }) =>
            toDriveNode(
              node,
              file,
            ),
        ),
    };
  }

  async function getRootView(
    ownerId: string,
  ): Promise<DriveFolderView> {
    const root =
      await ensureRootFolder(
        ownerId,
      );

    return getFolderView(
      ownerId,
      root.id,
    );
  }

  async function createFolder(
    input: {
      ownerId: string;
      parentId: string;
      name: string;
    },
  ): Promise<DriveNode> {
    await requireOwnedFolder(
      input.ownerId,
      input.parentId,
    );

    const preparedName =
      prepareDriveName(
        input.name,
      );

    try {
      const [createdFolder] =
        await db
          .insert(driveNodes)
          .values({
            ownerId:
              input.ownerId,

            parentId:
              input.parentId,

            kind:
              "folder",

            name:
              preparedName.name,

            normalizedName:
              preparedName
                .normalizedName,

            isRoot:
              false,
          })
          .returning();

      if (!createdFolder) {
        throw new Error(
          "Složku se nepodařilo vytvořit.",
        );
      }

      return toDriveNode(
        createdFolder,
      );
    } catch (error) {
      if (
        isUniqueViolation(
          error,
        )
      ) {
        throw new DuplicateDriveNameError();
      }

      throw error;
    }
  }

  async function renameFolder(
    input: {
      ownerId: string;
      folderId: string;
      name: string;
    },
  ): Promise<DriveNode> {
    const folder =
      await requireOwnedFolder(
        input.ownerId,
        input.folderId,
      );

    if (folder.isRoot) {
      throw new RootFolderMutationError();
    }

    const preparedName =
      prepareDriveName(
        input.name,
      );

    try {
      const [updatedFolder] =
        await db
          .update(driveNodes)
          .set({
            name:
              preparedName.name,

            normalizedName:
              preparedName
                .normalizedName,

            updatedAt:
              new Date(),
          })
          .where(
            and(
              eq(
                driveNodes.id,
                folder.id,
              ),

              eq(
                driveNodes.ownerId,
                input.ownerId,
              ),
            ),
          )
          .returning();

      if (!updatedFolder) {
        throw new DriveNodeNotFoundError();
      }

      return toDriveNode(
        updatedFolder,
      );
    } catch (error) {
      if (
        isUniqueViolation(
          error,
        )
      ) {
        throw new DuplicateDriveNameError();
      }

      throw error;
    }
  }

  /*
   * Projde cílovou větev směrem
   * nahoru.
   *
   * Pokud narazí na přesouvanou
   * složku, přesun by vytvořil cyklus.
   */

  async function assertMoveDoesNotCreateCycle(
    input: {
      ownerId: string;
      sourceFolderId: string;
      destinationFolderId: string;
    },
  ): Promise<void> {
    let currentId:
      | string
      | null =
        input.destinationFolderId;

    let depth = 0;

    while (currentId) {
      if (
        currentId ===
        input.sourceFolderId
      ) {
        throw new InvalidDriveMoveError(
          "Složku nelze přesunout do ní samotné ani do jejího potomka.",
        );
      }

      depth += 1;

      if (
        depth >
        MAX_TREE_DEPTH
      ) {
        throw new InvalidDriveMoveError(
          "Cílová cesta je příliš hluboká.",
        );
      }

      const current =
        await findOwnedNode(
          input.ownerId,
          currentId,
        );

      if (
        !current ||
        current.kind !== "folder"
      ) {
        throw new DriveNodeNotFoundError();
      }

      currentId =
        current.parentId;
    }
  }

  async function moveFolder(
    input: {
      ownerId: string;
      folderId: string;
      parentId: string;
    },
  ): Promise<DriveNode> {
    const folder =
      await requireOwnedFolder(
        input.ownerId,
        input.folderId,
      );

    if (folder.isRoot) {
      throw new RootFolderMutationError();
    }

    await requireOwnedFolder(
      input.ownerId,
      input.parentId,
    );

    await assertMoveDoesNotCreateCycle({
      ownerId:
        input.ownerId,

      sourceFolderId:
        folder.id,

      destinationFolderId:
        input.parentId,
    });

    if (
      folder.parentId ===
      input.parentId
    ) {
      return toDriveNode(
        folder,
      );
    }

    try {
      const [updatedFolder] =
        await db
          .update(driveNodes)
          .set({
            parentId:
              input.parentId,

            updatedAt:
              new Date(),
          })
          .where(
            and(
              eq(
                driveNodes.id,
                folder.id,
              ),

              eq(
                driveNodes.ownerId,
                input.ownerId,
              ),
            ),
          )
          .returning();

      if (!updatedFolder) {
        throw new DriveNodeNotFoundError();
      }

      return toDriveNode(
        updatedFolder,
      );
    } catch (error) {
      if (
        isUniqueViolation(
          error,
        )
      ) {
        throw new DuplicateDriveNameError();
      }

      throw error;
    }
  }

  /*
   * Seznam cílových složek
   * pro move dialog.
   */

  async function listFolderOptions(
    ownerId: string,
  ): Promise<
    DriveFolderOption[]
  > {
    const folders =
      await db
        .select()
        .from(driveNodes)
        .where(
          and(
            eq(
              driveNodes.ownerId,
              ownerId,
            ),

            eq(
              driveNodes.kind,
              "folder",
            ),
          ),
        );

    const byId =
      new Map(
        folders.map(
          (folder) => [
            folder.id,
            folder,
          ],
        ),
      );

    const pathCache =
      new Map<
        string,
        string
      >();

    function buildPath(
      folder: DriveNodeRecord,

      visited =
        new Set<string>(),
    ): string {
      const cachedPath =
        pathCache.get(
          folder.id,
        );

      if (cachedPath) {
        return cachedPath;
      }

      if (
        visited.has(
          folder.id,
        )
      ) {
        return folder.name;
      }

      visited.add(
        folder.id,
      );

      const parent =
        folder.parentId
          ? byId.get(
              folder.parentId,
            )
          : undefined;

      const path =
        parent
          ? `${buildPath(
              parent,
              visited,
            )} / ${folder.name}`
          : folder.name;

      pathCache.set(
        folder.id,
        path,
      );

      return path;
    }

    return folders
      .map(
        (folder) => ({
          id:
            folder.id,

          parentId:
            folder.parentId,

          name:
            folder.name,

          path:
            buildPath(
              folder,
            ),

          isRoot:
            folder.isRoot,
        }),
      )
      .sort(
        (
          left,
          right,
        ) =>
          left.path.localeCompare(
            right.path,
            "cs-CZ",
          ),
      );
  }

  return {
    createFolder,
    getFolderView,
    getRootView,
    listFolderOptions,
    moveFolder,
    renameFolder,
  };
}

export type DriveService =
  ReturnType<
    typeof createDriveService
  >;