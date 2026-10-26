ALTER TABLE deposits
  ADD COLUMN IF NOT EXISTS provider_invoice_id text UNIQUE,
  ADD COLUMN IF NOT EXISTS invoice_url text,
  ADD COLUMN IF NOT EXISTS invoice_address text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_amount text,
  ADD COLUMN IF NOT EXISTS provider_currency text,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS request_fingerprint text,
  ADD COLUMN IF NOT EXISTS provider_payload jsonb NOT NULL DEFAULT '{}';

CREATE UNIQUE INDEX IF NOT EXISTS deposits_idempotency_key_idx
  ON deposits (idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS provider_status text,
  ADD COLUMN IF NOT EXISTS provider_amount text,
  ADD COLUMN IF NOT EXISTS provider_currency text,
  ADD COLUMN IF NOT EXISTS provider_fee text,
  ADD COLUMN IF NOT EXISTS request_fingerprint text,
  ADD COLUMN IF NOT EXISTS payout_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS payout_quote_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_payload jsonb NOT NULL DEFAULT '{}';

CREATE UNIQUE INDEX IF NOT EXISTS withdrawals_idempotency_key_idx
  ON withdrawals (idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS approval_requests_one_live_per_transaction_idx
  ON approval_requests (transaction_type, transaction_id)
  WHERE status IN ('pending', 'approved');

CREATE TABLE IF NOT EXISTS provider_webhook_events (
  provider text NOT NULL,
  event_id text NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  PRIMARY KEY (provider, event_id)
);

CREATE TABLE IF NOT EXISTS support_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_id uuid NOT NULL REFERENCES investors(id),
  author_account_id uuid NOT NULL REFERENCES admin_accounts(id),
  note text NOT NULL CHECK (length(note) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_notes_investor_created_idx
  ON support_notes (investor_id, created_at DESC);
