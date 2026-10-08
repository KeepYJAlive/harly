CREATE TABLE "tao_remote_list_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"remote_list_id" uuid NOT NULL,
	"external_key" text NOT NULL,
	"label" text NOT NULL,
	"position" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tao_remote_list_entries_key_check" CHECK (length(trim("tao_remote_list_entries"."external_key")) > 0),
	CONSTRAINT "tao_remote_list_entries_label_check" CHECK (length(trim("tao_remote_list_entries"."label")) > 0)
);
--> statement-breakpoint
CREATE TABLE "tao_remote_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tao_remote_lists_key_check" CHECK ("tao_remote_lists"."key" ~ '^[a-z][a-z0-9_]{0,99}$'),
	CONSTRAINT "tao_remote_lists_name_check" CHECK (length(trim("tao_remote_lists"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "tao_remote_list_token_ciphertext" text;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "tao_remote_list_token_iv" text;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "tao_remote_list_token_tag" text;--> statement-breakpoint
ALTER TABLE "tao_remote_list_entries" ADD CONSTRAINT "tao_remote_list_entries_remote_list_id_tao_remote_lists_id_fk" FOREIGN KEY ("remote_list_id") REFERENCES "public"."tao_remote_lists"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tao_remote_lists" ADD CONSTRAINT "tao_remote_lists_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tao_remote_list_entries_key_uidx" ON "tao_remote_list_entries" USING btree ("remote_list_id","external_key");--> statement-breakpoint
CREATE UNIQUE INDEX "tao_remote_lists_org_key_uidx" ON "tao_remote_lists" USING btree ("organization_id","key");