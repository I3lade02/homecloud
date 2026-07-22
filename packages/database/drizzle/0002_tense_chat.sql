CREATE TYPE "public"."upload_status" AS ENUM('created', 'uploading', 'processing', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "blobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"checksum_sha256" char(64) NOT NULL,
	"storage_key" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blobs_checksum_sha256_unique" UNIQUE("checksum_sha256"),
	CONSTRAINT "blobs_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "upload_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"expected_size" bigint NOT NULL,
	"received_size" bigint DEFAULT 0 NOT NULL,
	"status" "upload_status" DEFAULT 'created' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "upload_sessions_node_id_unique" UNIQUE("node_id"),
	CONSTRAINT "upload_sessions_size_check" CHECK (
        "upload_sessions"."expected_size" >= 0
        AND "upload_sessions"."received_size" >= 0
        AND "upload_sessions"."received_size"
          <= "upload_sessions"."expected_size"
      )
);
--> statement-breakpoint
ALTER TABLE "file_entries" ADD COLUMN "blob_id" uuid;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_node_id_drive_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."drive_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "blobs_checksum_idx" ON "blobs" USING btree ("checksum_sha256");--> statement-breakpoint
CREATE INDEX "upload_sessions_owner_idx" ON "upload_sessions" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "upload_sessions_status_idx" ON "upload_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "upload_sessions_expires_idx" ON "upload_sessions" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "file_entries" ADD CONSTRAINT "file_entries_blob_id_blobs_id_fk" FOREIGN KEY ("blob_id") REFERENCES "public"."blobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_entries_blob_idx" ON "file_entries" USING btree ("blob_id");--> statement-breakpoint
ALTER TABLE "file_entries" DROP COLUMN "checksum_sha256";--> statement-breakpoint
ALTER TABLE "file_entries" DROP COLUMN "storage_key";--> statement-breakpoint
ALTER TABLE "file_entries" ADD CONSTRAINT "file_entries_ready_blob_check" CHECK (
        "file_entries"."status" <> 'ready'
        OR "file_entries"."blob_id" IS NOT NULL
      );