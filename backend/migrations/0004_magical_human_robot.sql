CREATE TABLE `auth_identities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`provider` text NOT NULL,
	`provider_account_id` text NOT NULL,
	`password_hash` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_identities_provider_provider_account_id_unique` ON `auth_identities` (`provider`,`provider_account_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`user_agent` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`avatar_url` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
-- SQLite rejects `ALTER TABLE ... ADD COLUMN ... NOT NULL` with no DEFAULT
-- whenever the table already has rows (every table below may already hold
-- this deployment's pre-multi-user data) -- SQLITE_ERROR: "Cannot add a
-- NOT NULL column with default value NULL". A placeholder user absorbs
-- every pre-existing row's ownership so the NOT NULL constraint is
-- satisfiable immediately; the one-off manual migration described in
-- docs/superpowers/specs/2026-11-05-multi-user-auth-design.md's "Existing
-- data migration" section reassigns these rows from this placeholder to
-- the real first account once it signs up, the same as it would have
-- reassigned them from NULL. The inline REFERENCES clause is omitted on
-- these six ALTER TABLE statements only (unlike the CREATE TABLE
-- statements above, which keep theirs) -- SQLite separately rejects
-- combining REFERENCES with a non-NULL DEFAULT on ALTER TABLE ADD COLUMN
-- ("Cannot add a REFERENCES column with non-NULL default value").
-- Drizzle's schema.ts still declares .references() for every one of
-- these columns, which is what matters for the ORM's own query-building
-- and type inference; D1/SQLite does not enforce foreign keys unless
-- PRAGMA foreign_keys=ON is set per-connection, which this project does
-- not currently rely on for any existing column either.
INSERT INTO `users` (`id`, `email`, `display_name`, `created_at`) VALUES (1, 'unmigrated@local.invalid', 'Unmigrated data', '1970-01-01T00:00:00.000Z');--> statement-breakpoint
ALTER TABLE `bills` ADD `user_id` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `budgets` ADD `user_id` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `capture_runs` ADD `user_id` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `category_rules` ADD `user_id` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `gmail_credentials` ADD `user_id` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `gmail_credentials_user_id_unique` ON `gmail_credentials` (`user_id`);--> statement-breakpoint
ALTER TABLE `transactions` ADD `user_id` integer DEFAULT 1 NOT NULL;
