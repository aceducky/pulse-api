CREATE TABLE `registry` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`frequency` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`alert_on_latency_ms` integer,
	`alert_on_status_above` integer,
	`alert_on_body_contains` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `registry_name_unique` ON `registry` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `registry_url_unique` ON `registry` (`url`);