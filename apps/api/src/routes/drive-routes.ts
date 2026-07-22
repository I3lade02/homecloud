import type { FastifyInstance, FastifyReply } from "fastify";

import { z } from "zod";

import type { RequireAuthHandler } from "../auth/require-auth";

import {
  DriveNodeNotFoundError,
  DuplicateDriveNameError,
  InvalidDriveMoveError,
  InvalidDriveNameError,
  RootFolderMutationError,
  type DriveService,
} from "../drive/drive-service";

const folderIdParamsSchema = z.object({
  folderId: z.string().uuid(),
});

const createFolderSchema = z.object({
  parentId: z.string().uuid(),

  name: z.string().min(1).max(255),
});

const renameFolderSchema = z.object({
  name: z.string().min(1).max(255),
});

const moveFolderSchema = z.object({
  parentId: z.string().uuid(),
});

function sendDriveError(reply: FastifyReply, error: unknown) {
  if (error instanceof DriveNodeNotFoundError) {
    return reply.code(404).send({
      error: "drive_node_not_found",

      message: error.message,
    });
  }

  if (error instanceof DuplicateDriveNameError) {
    return reply.code(409).send({
      error: "duplicate_drive_name",

      message: error.message,
    });
  }

  if (
    error instanceof InvalidDriveMoveError ||
    error instanceof InvalidDriveNameError ||
    error instanceof RootFolderMutationError
  ) {
    return reply.code(400).send({
      error: "invalid_drive_operation",

      message: error.message,
    });
  }

  throw error;
}

export async function registerDriveRoutes(
  app: FastifyInstance,

  options: {
    drive: DriveService;

    requireAuth: RequireAuthHandler;
  },
) {
  /*
   * Kořen uživatele.
   */

  app.get(
    "/drive/root",

    {
      preHandler: options.requireAuth,
    },

    async (request) => {
      return options.drive.getRootView(request.authUser!.id);
    },
  );

  /*
   * Seznam složek pro move dialog.
   */

  app.get(
    "/drive/folders",

    {
      preHandler: options.requireAuth,
    },

    async (request) => {
      return {
        folders: await options.drive.listFolderOptions(request.authUser!.id),
      };
    },
  );

  /*
   * Obsah konkrétní složky.
   */

  app.get(
    "/drive/folders/:folderId",

    {
      preHandler: options.requireAuth,
    },

    async (request, reply) => {
      const parsedParams = folderIdParamsSchema.safeParse(request.params);

      if (!parsedParams.success) {
        return reply.code(400).send({
          error: "validation_error",

          message: "Identifikátor složky není platný.",
        });
      }

      try {
        return await options.drive.getFolderView(
          request.authUser!.id,

          parsedParams.data.folderId,
        );
      } catch (error) {
        return sendDriveError(reply, error);
      }
    },
  );

  /*
   * Vytvoření složky.
   */

  app.post(
    "/drive/folders",

    {
      preHandler: options.requireAuth,
    },

    async (request, reply) => {
      const parsedBody = createFolderSchema.safeParse(request.body);

      if (!parsedBody.success) {
        return reply.code(400).send({
          error: "validation_error",

          message: "Zkontroluj název a cílovou složku.",

          issues: parsedBody.error.flatten().fieldErrors,
        });
      }

      try {
        const node = await options.drive.createFolder({
          ownerId: request.authUser!.id,

          parentId: parsedBody.data.parentId,

          name: parsedBody.data.name,
        });

        return reply.code(201).send({
          node,
        });
      } catch (error) {
        return sendDriveError(reply, error);
      }
    },
  );

  /*
   * Přejmenování složky.
   */

  app.patch(
    "/drive/folders/:folderId",

    {
      preHandler: options.requireAuth,
    },

    async (request, reply) => {
      const parsedParams = folderIdParamsSchema.safeParse(request.params);

      const parsedBody = renameFolderSchema.safeParse(request.body);

      if (!parsedParams.success || !parsedBody.success) {
        return reply.code(400).send({
          error: "validation_error",

          message: "Zkontroluj identifikátor a nový název složky.",
        });
      }

      try {
        const node = await options.drive.renameFolder({
          ownerId: request.authUser!.id,

          folderId: parsedParams.data.folderId,

          name: parsedBody.data.name,
        });

        return reply.send({
          node,
        });
      } catch (error) {
        return sendDriveError(reply, error);
      }
    },
  );

  /*
   * Přesunutí složky.
   */

  app.post(
    "/drive/folders/:folderId/move",

    {
      preHandler: options.requireAuth,
    },

    async (request, reply) => {
      const parsedParams = folderIdParamsSchema.safeParse(request.params);

      const parsedBody = moveFolderSchema.safeParse(request.body);

      if (!parsedParams.success || !parsedBody.success) {
        return reply.code(400).send({
          error: "validation_error",

          message: "Zkontroluj zdrojovou a cílovou složku.",
        });
      }

      try {
        const node = await options.drive.moveFolder({
          ownerId: request.authUser!.id,

          folderId: parsedParams.data.folderId,

          parentId: parsedBody.data.parentId,
        });

        return reply.send({
          node,
        });
      } catch (error) {
        return sendDriveError(reply, error);
      }
    },
  );
}
