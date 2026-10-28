CREATE TABLE `auth_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`subject` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`subject`) REFERENCES `google_accounts`(`subject`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `auth_session_expiry` ON `auth_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `google_accounts` (
	`subject` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `google_account_owner` ON `google_accounts` (`owner_id`);--> statement-breakpoint
CREATE TABLE `oauth_flows` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`browser_hash` text NOT NULL,
	`nonce` text NOT NULL,
	`verifier` text NOT NULL,
	`return_to` text NOT NULL,
	`link_owner_id` text,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `oauth_flow_expiry` ON `oauth_flows` (`expires_at`);