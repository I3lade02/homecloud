import { relations, sql } from "drizzle-orm";

import {
  type AnyPgColumn,
  bigint,
  boolean,
  char,
  check,
  index,
  inet,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["owner", "admin", "member"]);

export const driveNodeKindEnum = pgEnum("drive_node_kind", ["folder", "file"]);

export const fileStatusEnum = pgEnum("file_status", [
  "pending",
  "ready",
  "quarantined",
  "failed",
]);

export const uploadStatusEnum = pgEnum("upload_status", [
  "created",
  "uploading",
  "processing",
  "completed",
  "failed",
  "cancelled",
]);

export const filePreviewStatusEnum = pgEnum("file_preview_status", [
  "pending",
  "processing",
  "ready",
  "unsupported",
  "failed",
]);

/*
 * Users
 */

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    email: varchar("email", {
      length: 320,
    })
      .notNull()
      .unique(),

    displayName: varchar("display_name", {
      length: 80,
    }).notNull(),

    passwordHash: text("password_hash").notNull(),

    role: userRoleEnum("role").default("member").notNull(),

    isActive: boolean("is_active").default(true).notNull(),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp("updated_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),

    lastLoginAt: timestamp("last_login_at", {
      withTimezone: true,
    }),
  },
  (table) => [
    index("users_role_idx").on(table.role),

    index("users_active_idx").on(table.isActive),
  ],
);

/*
 * Virtual file tree
 *
 * Složky i soubory jsou uzly
 * stejného stromu.
 */

export const driveNodes = pgTable(
  "drive_nodes",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
      }),

    /*
     * Explicitní návratový typ
     * je potřeba kvůli
     * self-reference tabulky.
     */
    parentId: uuid("parent_id").references((): AnyPgColumn => driveNodes.id, {
      onDelete: "cascade",
    }),

    kind: driveNodeKindEnum("kind").notNull(),

    name: varchar("name", {
      length: 255,
    }).notNull(),

    /*
     * Slouží pro kontrolu
     * duplicit bez ohledu
     * na velikost písmen.
     */
    normalizedName: varchar("normalized_name", {
      length: 255,
    }).notNull(),

    isRoot: boolean("is_root").default(false).notNull(),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp("updated_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    /*
     * Každý uživatel může mít
     * jen jeden root.
     */
    uniqueIndex("drive_nodes_one_root_per_owner_idx")
      .on(table.ownerId)
      .where(sql`${table.isRoot} = true`),

    /*
     * Ve stejné složce nesmí
     * existovat dvě položky
     * se stejným názvem.
     */
    uniqueIndex("drive_nodes_parent_name_unique_idx")
      .on(table.ownerId, table.parentId, table.normalizedName)
      .where(sql`${table.isRoot} = false`),

    index("drive_nodes_parent_idx").on(table.ownerId, table.parentId),

    index("drive_nodes_kind_idx").on(table.ownerId, table.kind),

    /*
     * Root musí být složka
     * bez rodiče.
     *
     * Ostatní uzly rodiče mít musí.
     */
    check(
      "drive_nodes_root_shape_check",

      sql`
        (
          ${table.isRoot} = true
          AND ${table.parentId} IS NULL
          AND ${table.kind} = 'folder'
        )
        OR
        (
          ${table.isRoot} = false
          AND ${table.parentId} IS NOT NULL
        )
      `,
    ),
  ],
);

/*
 * Metadata fyzického souboru.
 *
 * Zatím žádné záznamy nevytváříme.
 * Použijeme je v Milníku 4.
 */

export const blobs = pgTable(
  "blobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    checksumSha256: char("checksum_sha256", {
      length: 64,
    })
      .notNull()
      .unique(),

    storageKey: text("storage_key").notNull().unique(),

    sizeBytes: bigint("size_bytes", {
      mode: "bigint",
    }).notNull(),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("blobs_checksum_idx").on(table.checksumSha256)],
);

export const fileEntries = pgTable(
  "file_entries",
  {
    nodeId: uuid("node_id")
      .primaryKey()
      .references(() => driveNodes.id, {
        onDelete: "cascade",
      }),

    blobId: uuid("blob_id").references(() => blobs.id, {
      onDelete: "restrict",
    }),

    sizeBytes: bigint("size_bytes", {
      mode: "bigint",
    }).notNull(),

    mimeType: varchar("mime_type", {
      length: 255,
    }).notNull(),

    status: fileStatusEnum("status").default("pending").notNull(),

    metadata:
      jsonb("metadata").$type<
        Record<string, string | number | boolean | null>
      >(),

    previewStatus: filePreviewStatusEnum("preview_status")
      .default("pending")
      .notNull(),

    previewKey: text("preview_key"),

    previewMimeType: varchar("preview_mime_type", {
      length: 100,
    }),

    previewError: text("preview_error"),

    processedAt: timestamp("processed_at", {
      withTimezone: true,
    }),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),

    updatedAt: timestamp("updated_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("file_entries_status_idx").on(table.status),

    index("file_entries_blob_idx").on(table.blobId),

    check(
      "file_entries_ready_blob_check",

      sql`
        ${table.status} <> 'ready'
        OR ${table.blobId} IS NOT NULL
      `,
    ),
  ],
);

export const uploadSessions = pgTable(
  "upload_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
      }),

    nodeId: uuid("node_id")
      .notNull()
      .unique()
      .references(() => driveNodes.id, {
        onDelete: "cascade",
      }),

    expectedSize: bigint("expected_size", {
      mode: "bigint",
    }).notNull(),

    receivedSize: bigint("received_size", {
      mode: "bigint",
    })
      .default(sql`0`)
      .notNull(),

    status: uploadStatusEnum("status").default("created").notNull(),

    errorMessage: text("error_message"),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),

    startedAt: timestamp("started_at", {
      withTimezone: true,
    }),

    updatedAt: timestamp("updated_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),

    completedAt: timestamp("completed_at", {
      withTimezone: true,
    }),

    expiresAt: timestamp("expires_at", {
      withTimezone: true,
    }).notNull(),
  },
  (table) => [
    index("upload_sessions_owner_idx").on(table.ownerId),

    index("upload_sessions_status_idx").on(table.status),

    index("upload_sessions_expires_idx").on(table.expiresAt),

    check(
      "upload_sessions_size_check",

      sql`
        ${table.expectedSize} >= 0
        AND ${table.receivedSize} >= 0
        AND ${table.receivedSize}
          <= ${table.expectedSize}
      `,
    ),
  ],
);

/*
 * Sessions
 */

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "cascade",
      }),

    tokenHash: char("token_hash", {
      length: 64,
    })
      .notNull()
      .unique(),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),

    expiresAt: timestamp("expires_at", {
      withTimezone: true,
    }).notNull(),

    lastSeenAt: timestamp("last_seen_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),

    revokedAt: timestamp("revoked_at", {
      withTimezone: true,
    }),

    ipAddress: inet("ip_address"),

    userAgent: text("user_agent"),
  },
  (table) => [
    index("sessions_user_id_idx").on(table.userId),

    index("sessions_expires_at_idx").on(table.expiresAt),
  ],
);

/*
 * Audit
 */

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),

    event: varchar("event", {
      length: 80,
    }).notNull(),

    ipAddress: inet("ip_address"),

    userAgent: text("user_agent"),

    metadata: jsonb("metadata").$type<Record<string, unknown>>(),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("audit_logs_event_idx").on(table.event),

    index("audit_logs_actor_idx").on(table.actorUserId),

    index("audit_logs_created_at_idx").on(table.createdAt),
  ],
);

/*
 * Relations
 */

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),

  auditLogs: many(auditLogs),

  driveNodes: many(driveNodes),

  uploadSessions: many(uploadSessions),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],

    references: [users.id],
  }),
}));

export const driveNodesRelations = relations(driveNodes, ({ one, many }) => ({
  owner: one(users, {
    fields: [driveNodes.ownerId],

    references: [users.id],
  }),

  parent: one(driveNodes, {
    fields: [driveNodes.parentId],

    references: [driveNodes.id],

    relationName: "drive_tree",
  }),

  children: many(driveNodes, {
    relationName: "drive_tree",
  }),

  file: one(fileEntries),
}));

export const fileEntriesRelations = relations(fileEntries, ({ one }) => ({
  node: one(driveNodes, {
    fields: [fileEntries.nodeId],

    references: [driveNodes.id],
  }),

  blob: one(blobs, {
    fields: [fileEntries.blobId],

    references: [blobs.id],
  }),
}));

export const blobsRelations = relations(blobs, ({ many }) => ({
  files: many(fileEntries),
}));

export const uploadSessionsRelations = relations(uploadSessions, ({ one }) => ({
  owner: one(users, {
    fields: [uploadSessions.ownerId],

    references: [users.id],
  }),

  node: one(driveNodes, {
    fields: [uploadSessions.nodeId],

    references: [driveNodes.id],
  }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  actor: one(users, {
    fields: [auditLogs.actorUserId],

    references: [users.id],
  }),
}));

/*
 * Exportované typy
 */

export type UserRecord = typeof users.$inferSelect;

export type NewUserRecord = typeof users.$inferInsert;

export type SessionRecord = typeof sessions.$inferSelect;

export type DriveNodeRecord = typeof driveNodes.$inferSelect;

export type NewDriveNodeRecord = typeof driveNodes.$inferInsert;

export type FileEntryRecord = typeof fileEntries.$inferSelect;

export type UserRole = (typeof userRoleEnum.enumValues)[number];

export type DriveNodeKind = (typeof driveNodeKindEnum.enumValues)[number];

export type FileStatus = (typeof fileStatusEnum.enumValues)[number];

export type BlobRecord = typeof blobs.$inferSelect;

export type UploadSessionRecord = typeof uploadSessions.$inferSelect;

export type UploadStatus = (typeof uploadStatusEnum.enumValues)[number];

export type FilePreviewStatus =
  (typeof filePreviewStatusEnum.enumValues)[number];
