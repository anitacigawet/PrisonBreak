-- Fresh-install schema for the public PrisonBreak release.
-- This repository intentionally does not migrate databases created by private
-- development builds. Local release data begins from this baseline.

CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`openId` text NOT NULL,
	`name` text,
	`email` text,
	`loginMethod` text,
	`role` text DEFAULT 'user' NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	`lastSignedIn` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_openId_unique` ON `users` (`openId`);
--> statement-breakpoint
CREATE TABLE `cases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`userId` integer NOT NULL,
	`caseNumber` text,
	`title` text NOT NULL,
	`jurisdiction` text,
	`charges` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`ragIndexedAt` integer,
	`caseFacts` text,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`caseId` integer NOT NULL,
	`fileName` text NOT NULL,
	`fileKey` text NOT NULL,
	`fileUrl` text NOT NULL,
	`fileHash` text NOT NULL,
	`mimeType` text,
	`fileSize` integer,
	`ragIndexedAt` integer,
	`ragChunkCount` integer DEFAULT 0 NOT NULL,
	`uploadedAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `caseNotes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`caseId` integer NOT NULL,
	`userId` integer NOT NULL,
	`content` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `casePetals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`caseId` integer NOT NULL,
	`petalKey` text NOT NULL,
	`corpusKey` text,
	`sourceCount` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`summary` text,
	`reasonSkipped` text,
	`errorMessage` text,
	`startedAt` integer,
	`completedAt` integer,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `casePetals_case_idx` ON `casePetals` (`caseId`);
--> statement-breakpoint
CREATE INDEX `casePetals_status_idx` ON `casePetals` (`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `casePetals_case_key_idx` ON `casePetals` (`caseId`, `petalKey`);
--> statement-breakpoint
CREATE TABLE `researchSources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`caseId` integer NOT NULL,
	`corpusKey` text NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`publisher` text,
	`excerpt` text NOT NULL,
	`snapshotPath` text NOT NULL,
	`contentHash` text NOT NULL,
	`retrievedAt` integer NOT NULL,
	`indexedAt` integer,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `researchSources_case_corpus_idx` ON `researchSources` (`caseId`, `corpusKey`);
--> statement-breakpoint
CREATE UNIQUE INDEX `researchSources_case_url_hash_idx` ON `researchSources` (`caseId`, `corpusKey`, `url`, `contentHash`);
--> statement-breakpoint
CREATE TABLE `trialResults` (
	`caseId` integer PRIMARY KEY NOT NULL,
	`result` text NOT NULL,
	`completedAt` integer DEFAULT (unixepoch()) NOT NULL,
	`handoff` text
);
