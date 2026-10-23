CREATE TABLE "auth_account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_version" (
	"owner_id" text NOT NULL,
	"document_id" text NOT NULL,
	"id" text NOT NULL,
	"label" text NOT NULL,
	"title" text NOT NULL,
	"content" jsonb NOT NULL,
	"document_revision" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_version_owner_id_id_pk" PRIMARY KEY("owner_id","id"),
	CONSTRAINT "version_revision_positive" CHECK ("document_version"."document_revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "library_item" (
	"owner_id" text NOT NULL,
	"id" text NOT NULL,
	"kind" text NOT NULL,
	"parent_id" text,
	"title" text NOT NULL,
	"content" jsonb,
	"format_version" integer,
	"revision" integer DEFAULT 1 NOT NULL,
	"starred" boolean DEFAULT false NOT NULL,
	"trashed_at" timestamp with time zone,
	"trash_group" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "library_item_owner_id_id_pk" PRIMARY KEY("owner_id","id"),
	CONSTRAINT "library_revision_positive" CHECK ("library_item"."revision" > 0),
	CONSTRAINT "library_title_length" CHECK (length("library_item"."title") between 1 and 500),
	CONSTRAINT "library_not_own_parent" CHECK ("library_item"."parent_id" is null or "library_item"."parent_id" <> "library_item"."id"),
	CONSTRAINT "library_payload" CHECK (("library_item"."kind" = 'folder' and "library_item"."content" is null and "library_item"."format_version" is null) or ("library_item"."kind" = 'document' and jsonb_typeof("library_item"."content") = 'object' and "library_item"."content" is not null and "library_item"."format_version" > 0 and "library_item"."format_version" is not null))
);
--> statement-breakpoint
CREATE TABLE "auth_session" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "auth_verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_version" ADD CONSTRAINT "version_document_same_owner" FOREIGN KEY ("owner_id","document_id") REFERENCES "public"."library_item"("owner_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_item" ADD CONSTRAINT "library_item_owner_id_app_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_item" ADD CONSTRAINT "library_parent_same_owner" FOREIGN KEY ("owner_id","parent_id") REFERENCES "public"."library_item"("owner_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_account_provider_idx" ON "auth_account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "auth_account_user_idx" ON "auth_account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "version_document_idx" ON "document_version" USING btree ("owner_id","document_id","created_at","id");--> statement-breakpoint
CREATE INDEX "library_owner_updated_idx" ON "library_item" USING btree ("owner_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "library_parent_idx" ON "library_item" USING btree ("owner_id","parent_id");--> statement-breakpoint
CREATE INDEX "auth_session_user_idx" ON "auth_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_session_expiry_idx" ON "auth_session" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "auth_verification_identifier_idx" ON "auth_verification" USING btree ("identifier");