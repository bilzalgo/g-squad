ALTER TABLE support_notes
  ADD COLUMN IF NOT EXISTS escalated boolean NOT NULL DEFAULT false;
