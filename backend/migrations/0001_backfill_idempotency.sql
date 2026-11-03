ALTER TABLE `capture_runs` ADD `backfill_completed_at` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `gmail_message_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_gmail_message_id_unique` ON `transactions` (`gmail_message_id`);