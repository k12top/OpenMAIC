CREATE TYPE "public"."classroom_status" AS ENUM('generating', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."credit_transaction_type" AS ENUM('grant', 'consume', 'recharge');--> statement-breakpoint
CREATE TYPE "public"."media_type" AS ENUM('image', 'video', 'audio', 'tts');--> statement-breakpoint
CREATE TYPE "public"."share_mode" AS ENUM('readonly', 'editable');--> statement-breakpoint
CREATE TABLE "checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"classroom_id" text DEFAULT '',
	"step" text DEFAULT '' NOT NULL,
	"state_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "classroom_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"classroom_id" text NOT NULL,
	"media_type" "media_type" NOT NULL,
	"minio_key" text NOT NULL,
	"mime_type" text DEFAULT 'application/octet-stream',
	"size_bytes" bigint DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "classrooms" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"language" text DEFAULT 'en-US' NOT NULL,
	"stage_json" jsonb,
	"scenes_json" jsonb,
	"status" "classroom_status" DEFAULT 'generating' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"amount" integer NOT NULL,
	"type" "credit_transaction_type" NOT NULL,
	"description" text DEFAULT '',
	"related_api" text DEFAULT '',
	"token_count" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"balance" integer DEFAULT 100 NOT NULL,
	"total_earned" integer DEFAULT 100 NOT NULL,
	"total_consumed" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credits_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"classroom_id" text NOT NULL,
	"user_id" text NOT NULL,
	"share_token" text NOT NULL,
	"mode" "share_mode" DEFAULT 'readonly' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shares_share_token_unique" UNIQUE("share_token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"casdoor_name" text NOT NULL,
	"nickname" text DEFAULT '' NOT NULL,
	"avatar" text DEFAULT '',
	"email" text DEFAULT '',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classroom_media" ADD CONSTRAINT "classroom_media_classroom_id_classrooms_id_fk" FOREIGN KEY ("classroom_id") REFERENCES "public"."classrooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classrooms" ADD CONSTRAINT "classrooms_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credits" ADD CONSTRAINT "credits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shares" ADD CONSTRAINT "shares_classroom_id_classrooms_id_fk" FOREIGN KEY ("classroom_id") REFERENCES "public"."classrooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shares" ADD CONSTRAINT "shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_checkpoint_user" ON "checkpoints" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_media_classroom" ON "classroom_media" USING btree ("classroom_id");--> statement-breakpoint
CREATE INDEX "idx_classroom_user" ON "classrooms" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_credit_tx_user" ON "credit_transactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_share_token" ON "shares" USING btree ("share_token");