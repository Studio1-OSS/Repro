CREATE TABLE `fixes` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text,
	`status` text DEFAULT 'proposed' NOT NULL,
	`explanation` text NOT NULL,
	`edits` text NOT NULL,
	`diff` text NOT NULL,
	`test_hint` text,
	`files_read` integer DEFAULT 0 NOT NULL,
	`whole_repo` integer DEFAULT false NOT NULL,
	`sandbox` text,
	`pr_url` text,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`report_id`) REFERENCES `reports`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `fixes_report_idx` ON `fixes` (`report_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`origins` text NOT NULL,
	`source_type` text NOT NULL,
	`local_path` text,
	`github_repo` text,
	`github_branch` text,
	`github_token` text,
	`check_command` text,
	`start_command` text,
	`app_port` integer,
	`sign_in_path` text,
	`sign_in_email` text,
	`sign_in_password` text,
	`webhook_url` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `projects_user_idx` ON `projects` (`user_id`);