CREATE TYPE "public"."drive_node_kind" AS ENUM('folder', 'file');--> statement-breakpoint
CREATE TYPE "public"."file_status" AS ENUM('pending', 'ready', 'quarantined', 'failed');--> statement-breakpoint
CREATE TABLE "drive_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"parent_id" uuid,
	"kind" "drive_node_kind" NOT NULL,
	"name" varchar(255) NOT NULL,
	"normalized_name" varchar(255) NOT NULL,
	"is_root" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drive_nodes_root_shape_check" CHECK (
        (
          "drive_nodes"."is_root" = true
          AND "drive_nodes"."parent_id" IS NULL
          AND "drive_nodes"."kind" = 'folder'
        )
        OR
        (
          "drive_nodes"."is_root" = false
          AND "drive_nodes"."parent_id" IS NOT NULL
        )
      )
);
--> statement-breakpoint
CREATE TABLE "file_entries" (
	"node_id" uuid PRIMARY KEY NOT NULL,
	"size_bytes" bigint NOT NULL,
	"mime_type" varchar(255) NOT NULL,
	"status" "file_status" DEFAULT 'pending' NOT NULL,
	"checksum_sha256" char(64),
	"storage_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "drive_nodes" ADD CONSTRAINT "drive_nodes_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drive_nodes" ADD CONSTRAINT "drive_nodes_parent_id_drive_nodes_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."drive_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_entries" ADD CONSTRAINT "file_entries_node_id_drive_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."drive_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "drive_nodes_one_root_per_owner_idx" ON "drive_nodes" USING btree ("owner_id") WHERE "drive_nodes"."is_root" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "drive_nodes_parent_name_unique_idx" ON "drive_nodes" USING btree ("owner_id","parent_id","normalized_name") WHERE "drive_nodes"."is_root" = false;--> statement-breakpoint
CREATE INDEX "drive_nodes_parent_idx" ON "drive_nodes" USING btree ("owner_id","parent_id");--> statement-breakpoint
CREATE INDEX "drive_nodes_kind_idx" ON "drive_nodes" USING btree ("owner_id","kind");--> statement-breakpoint
CREATE INDEX "file_entries_status_idx" ON "file_entries" USING btree ("status");