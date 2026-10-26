CREATE TABLE IF NOT EXISTS admin_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id text NOT NULL UNIQUE,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('CEO', 'STAFF')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked', 'deactivated', 'enrollment_pending')),
  permissions text[] NOT NULL DEFAULT '{}',
  totp_secret_encrypted text,
  last_totp_counter bigint,
  enrollment_token_hash text UNIQUE,
  enrollment_expires_at timestamptz,
  session_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (role <> 'CEO' OR cardinality(permissions) = 0)
);

CREATE OR REPLACE FUNCTION enforce_admin_ceo_limit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ceo_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(71350421);
  IF TG_OP = 'UPDATE' THEN
    SELECT count(*) INTO ceo_count
      FROM admin_accounts WHERE role = 'CEO' AND id <> OLD.id;
  ELSE
    SELECT count(*) INTO ceo_count FROM admin_accounts WHERE role = 'CEO';
  END IF;
  IF NEW.role = 'CEO' THEN
    ceo_count := ceo_count + 1;
    IF ceo_count > 2 THEN
      RAISE EXCEPTION 'At most two CEO identities may exist' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS admin_ceo_limit ON admin_accounts;
CREATE TRIGGER admin_ceo_limit
  BEFORE INSERT OR UPDATE OF role, status ON admin_accounts
  FOR EACH ROW EXECUTE FUNCTION enforce_admin_ceo_limit();

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES admin_accounts(id),
  account_version integer NOT NULL,
  csrf_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_sessions_expiry_idx ON admin_sessions (expires_at);

CREATE TABLE IF NOT EXISTS auth_login_attempts (
  identity_key text PRIMARY KEY,
  failed_count integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz
);

CREATE TABLE IF NOT EXISTS investors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id text NOT NULL UNIQUE,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deactivated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallets (
  investor_id uuid PRIMARY KEY REFERENCES investors(id),
  currency char(3) NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  available_balance numeric(20, 2) NOT NULL DEFAULT 0 CHECK (available_balance >= 0),
  reserved_balance numeric(20, 2) NOT NULL DEFAULT 0 CHECK (reserved_balance >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_id uuid NOT NULL REFERENCES investors(id),
  amount_usd numeric(20, 2) NOT NULL CHECK (amount_usd > 0),
  currency text NOT NULL CHECK (currency IN ('BTC', 'USDT', 'TRX')),
  status text NOT NULL CHECK (status IN ('pending', 'payment_reported', 'payment_confirmed', 'awaiting_ceo', 'approved', 'rejected', 'credited', 'failed', 'expired')),
  provider_reference text UNIQUE,
  provider_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_id uuid NOT NULL REFERENCES investors(id),
  amount_usd numeric(20, 2) NOT NULL CHECK (amount_usd >= 1),
  destination text NOT NULL,
  currency text NOT NULL DEFAULT 'USDT' CHECK (currency = 'USDT'),
  network text NOT NULL DEFAULT 'TRC20' CHECK (network = 'TRC20'),
  status text NOT NULL CHECK (status IN ('pending_review', 'awaiting_ceo', 'ceo_approved', 'ceo_rejected', 'processing', 'paid', 'failed', 'cancelled')),
  provider_reference text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallet_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_id uuid NOT NULL REFERENCES investors(id),
  amount_usd numeric(20, 2) NOT NULL CHECK (amount_usd <> 0),
  available_after numeric(20, 2) NOT NULL CHECK (available_after >= 0),
  reserved_after numeric(20, 2) NOT NULL CHECK (reserved_after >= 0),
  entry_type text NOT NULL,
  reference text NOT NULL UNIQUE,
  idempotency_key text,
  request_fingerprint text,
  actor_account_id uuid REFERENCES admin_accounts(id),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS wallet_ledger_actor_idempotency_idx
  ON wallet_ledger (actor_account_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE OR REPLACE FUNCTION prevent_ledger_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Wallet ledger entries are append-only';
END;
$$;
DROP TRIGGER IF EXISTS wallet_ledger_immutable ON wallet_ledger;
CREATE TRIGGER wallet_ledger_immutable
  BEFORE UPDATE OR DELETE ON wallet_ledger
  FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

CREATE TABLE IF NOT EXISTS approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_type text NOT NULL CHECK (transaction_type IN ('deposit', 'withdrawal')),
  transaction_id uuid NOT NULL,
  requested_by uuid NOT NULL REFERENCES admin_accounts(id),
  proposed_action text NOT NULL CHECK (proposed_action IN ('approve', 'reject')),
  proposal_fingerprint text NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'more_information', 'executed')),
  decided_by uuid REFERENCES admin_accounts(id),
  decision_reason text,
  decided_at timestamptz,
  final_action_by uuid REFERENCES admin_accounts(id),
  final_action_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_account_id uuid REFERENCES admin_accounts(id),
  actor_label text NOT NULL,
  actor_role text NOT NULL CHECK (actor_role IN ('CEO', 'STAFF', 'INVESTOR', 'SYSTEM', 'ANONYMOUS')),
  action_type text NOT NULL,
  affected_account_id text,
  transaction_id text,
  approval_request_id text,
  details jsonb NOT NULL DEFAULT '{}',
  result text NOT NULL CHECK (result IN ('success', 'failure', 'denied')),
  request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON audit_logs (actor_account_id, created_at DESC);

CREATE OR REPLACE FUNCTION prevent_audit_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit history is append-only';
END;
$$;
DROP TRIGGER IF EXISTS audit_logs_immutable ON audit_logs;
CREATE TRIGGER audit_logs_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();

CREATE TABLE IF NOT EXISTS trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_reference text UNIQUE,
  status text NOT NULL,
  profit_loss numeric(20, 2),
  result jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by uuid REFERENCES admin_accounts(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES admin_accounts(id),
  message text NOT NULL,
  related_type text,
  related_id text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
