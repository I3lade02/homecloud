CREATE TYPE "public"."file_preview_status" AS ENUM('pending', 'processing', 'ready', 'unsupported', 'failed');--> statement-breakpoint
ALTER TABLE "file_entries" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "file_entries" ADD COLUMN "preview_status" "file_preview_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "file_entries" ADD COLUMN "preview_key" text;--> statement-breakpoint
ALTER TABLE "file_entries" ADD COLUMN "preview_mime_type" varchar(100);--> statement-breakpoint
ALTER TABLE "file_entries" ADD COLUMN "preview_error" text;--> statement-breakpoint
ALTER TABLE "file_entries" ADD COLUMN "processed_at" timestamp with time zone;