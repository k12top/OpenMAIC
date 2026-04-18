CREATE TYPE "public"."chat_session_status" AS ENUM('active', 'completed', 'interrupted');--> statement-breakpoint
CREATE TYPE "public"."interaction_type" AS ENUM('quiz', 'transcription', 'pbl');--> statement-breakpoint
CREATE TABLE "chat_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"classroom_id" text NOT NULL,
	"user_id" text NOT NULL,
	"scene_id" text DEFAULT '',
	"type" text DEFAULT 'chat' NOT NULL,
	"title" text DEFAULT '',
	"status" "chat_session_status" DEFAULT 'active' NOT NULL,
	"messages_json" jsonb,
	"config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "classroom_interactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"classroom_id" text NOT NULL,
	"user_id" text NOT NULL,
	"scene_id" text DEFAULT '',
	"type" "interaction_type" NOT NULL,
	"input_json" jsonb,
	"output_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_classroom_id_classrooms_id_fk" FOREIGN KEY ("classroom_id") REFERENCES "public"."classrooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classroom_interactions" ADD CONSTRAINT "classroom_interactions_classroom_id_classrooms_id_fk" FOREIGN KEY ("classroom_id") REFERENCES "public"."classrooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classroom_interactions" ADD CONSTRAINT "classroom_interactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_chat_session_classroom" ON "chat_sessions" USING btree ("classroom_id");--> statement-breakpoint
CREATE INDEX "idx_chat_session_user" ON "chat_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_interaction_classroom" ON "classroom_interactions" USING btree ("classroom_id");--> statement-breakpoint
CREATE INDEX "idx_interaction_user" ON "classroom_interactions" USING btree ("user_id");