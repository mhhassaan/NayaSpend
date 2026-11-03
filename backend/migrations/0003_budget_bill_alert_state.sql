PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_bills` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vendor` text NOT NULL,
	`expected_amount` integer NOT NULL,
	`expected_interval` text NOT NULL,
	`next_due_date` text NOT NULL,
	`last_reminder_sent_for_due_date` text,
	CONSTRAINT "expected_amount_is_positive_integer" CHECK("__new_bills"."expected_amount" = CAST("__new_bills"."expected_amount" AS INTEGER) AND "__new_bills"."expected_amount" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_bills`("id", "vendor", "expected_amount", "expected_interval", "next_due_date", "last_reminder_sent_for_due_date") SELECT "id", "vendor", "expected_amount", "expected_interval", "next_due_date", "last_reminder_sent_for_due_date" FROM `bills`;--> statement-breakpoint
DROP TABLE `bills`;--> statement-breakpoint
ALTER TABLE `__new_bills` RENAME TO `bills`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_budgets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`category` text NOT NULL,
	`limit_amount` integer NOT NULL,
	`period_type` text NOT NULL,
	`last_alerted_threshold` text,
	`last_alerted_period_start` text,
	CONSTRAINT "limit_amount_is_positive_integer" CHECK("__new_budgets"."limit_amount" = CAST("__new_budgets"."limit_amount" AS INTEGER) AND "__new_budgets"."limit_amount" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_budgets`("id", "category", "limit_amount", "period_type", "last_alerted_threshold", "last_alerted_period_start") SELECT "id", "category", "limit_amount", "period_type", "last_alerted_threshold", "last_alerted_period_start" FROM `budgets`;--> statement-breakpoint
DROP TABLE `budgets`;--> statement-breakpoint
ALTER TABLE `__new_budgets` RENAME TO `budgets`;