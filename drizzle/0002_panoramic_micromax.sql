CREATE TABLE "orders" (
	"sessionId" varchar(255) PRIMARY KEY NOT NULL,
	"status" varchar NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"userId" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "apiKeys" ADD COLUMN "clientId" varchar(100) NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "plan" text;--> statement-breakpoint
ALTER TABLE "apiKeys" ADD CONSTRAINT "apiKeys_clientId_unique" UNIQUE("clientId");