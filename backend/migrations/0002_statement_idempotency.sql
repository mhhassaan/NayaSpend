ALTER TABLE `transactions` ADD `statement_row_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_statement_row_key_unique` ON `transactions` (`statement_row_key`);