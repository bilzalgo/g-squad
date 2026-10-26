CREATE INDEX IF NOT EXISTS deposits_investor_created_idx
  ON deposits (investor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS withdrawals_investor_created_idx
  ON withdrawals (investor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS wallet_ledger_investor_created_idx
  ON wallet_ledger (investor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_affected_created_idx
  ON audit_logs (affected_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_account_detail_created_idx
  ON audit_logs ((details->>'accountId'), created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_investor_detail_created_idx
  ON audit_logs ((details->>'investorAccountId'), created_at DESC);

ALTER TABLE investors
  ADD COLUMN IF NOT EXISTS username text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS anonymized_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS investors_username_ci_idx
  ON investors (lower(username)) WHERE username IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS investors_email_ci_idx
  ON investors (lower(email)) WHERE email IS NOT NULL;
