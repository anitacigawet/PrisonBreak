ALTER TABLE cases ADD COLUMN deletionState TEXT NOT NULL DEFAULT 'active';
--> statement-breakpoint
ALTER TABLE cases ADD COLUMN deletionError TEXT;
