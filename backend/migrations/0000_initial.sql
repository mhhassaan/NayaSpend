CREATE TABLE `bills` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vendor` text NOT NULL,
	`expected_amount` integer NOT NULL,
	`expected_interval` text NOT NULL,
	`next_due_date` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `budgets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category` text NOT NULL,
	`limit_amount` integer NOT NULL,
	`period_type` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `capture_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`last_attempted_run` text,
	`last_successful_run` text,
	`run_status` text NOT NULL,
	`error_type` text,
	`backfill_page_token` text,
	`polling_history_id` text
);
--> statement-breakpoint
CREATE TABLE `category_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vendor_normalized` text NOT NULL,
	`category` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `category_rules_vendor_normalized_unique` ON `category_rules` (`vendor_normalized`);--> statement-breakpoint
CREATE TABLE `gmail_credentials` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`encrypted_access_token` text NOT NULL,
	`encrypted_refresh_token` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`amount` integer NOT NULL,
	`date` text NOT NULL,
	`vendor_raw` text NOT NULL,
	`vendor_normalized` text NOT NULL,
	`category` text DEFAULT 'Uncategorized' NOT NULL,
	`source` text NOT NULL,
	`provenance` text NOT NULL,
	`review_status` text NOT NULL,
	`dedup_group_id` text,
	`dedup_resolution` text,
	`deleted_at` text,
	CONSTRAINT "amount_is_integer" CHECK("transactions"."amount" = CAST("transactions"."amount" AS INTEGER))
);
