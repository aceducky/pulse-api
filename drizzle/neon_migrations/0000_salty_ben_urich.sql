CREATE TABLE "check_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monitor_id" text NOT NULL,
	"url" text NOT NULL,
	"status_code" integer,
	"latency_ms" integer,
	"error" text,
	"alert_triggered" text,
	"checked_at" timestamp DEFAULT now() NOT NULL
);
