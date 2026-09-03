-- Phase 7 Payments: payment ledger, manual methods, transfer proofs, Mercado Pago OAuth/Orders, cancellation/refund workflow.
PRAGMA foreign_keys=ON;

ALTER TABLE tournament_registrations ADD COLUMN paid_amount_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tournament_registrations ADD COLUMN refunded_amount_minor INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS payment_accounts (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('mercado_pago')),
  label TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','expired','revoked','error')),
  external_account_id TEXT,
  public_key TEXT,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,
  token_expires_at INTEGER,
  live_mode INTEGER NOT NULL DEFAULT 0,
  created_by_user_id TEXT NOT NULL REFERENCES user(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS payment_accounts_org_idx ON payment_accounts(organization_id,provider,status);
CREATE UNIQUE INDEX IF NOT EXISTS payment_accounts_provider_external_uq ON payment_accounts(provider,external_account_id) WHERE external_account_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS tournament_payment_settings (
  tournament_id TEXT PRIMARY KEY NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  bank_transfer_enabled INTEGER NOT NULL DEFAULT 1,
  cash_enabled INTEGER NOT NULL DEFAULT 0,
  mercado_pago_enabled INTEGER NOT NULL DEFAULT 0,
  mercado_pago_account_id TEXT REFERENCES payment_accounts(id) ON DELETE SET NULL,
  bank_name TEXT,
  bank_account_holder TEXT,
  bank_account_number TEXT,
  bank_account_alias TEXT,
  bank_currency TEXT NOT NULL DEFAULT 'UYU',
  bank_instructions TEXT,
  transfer_proof_required INTEGER NOT NULL DEFAULT 1,
  cash_instructions TEXT,
  payment_due_at INTEGER,
  refund_policy TEXT NOT NULL DEFAULT 'manual' CHECK (refund_policy IN ('manual','none','full_before_deadline')),
  refund_deadline_at INTEGER,
  cancellation_policy_text TEXT,
  updated_by_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payment_orders (
  id TEXT PRIMARY KEY NOT NULL,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  payer_kind TEXT NOT NULL CHECK (payer_kind IN ('user','manual_profile')),
  payer_user_id TEXT REFERENCES user(id) ON DELETE RESTRICT,
  payer_profile_id TEXT REFERENCES tournament_player_profiles(id) ON DELETE RESTRICT,
  payer_name TEXT NOT NULL,
  payer_email TEXT,
  currency TEXT NOT NULL DEFAULT 'UYU',
  subtotal_minor INTEGER NOT NULL DEFAULT 0,
  discount_minor INTEGER NOT NULL DEFAULT 0,
  total_amount_minor INTEGER NOT NULL DEFAULT 0,
  amount_paid_minor INTEGER NOT NULL DEFAULT 0,
  amount_refunded_minor INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('draft','awaiting_payment','pending_review','paid','cancelled','partially_refunded','refunded')),
  selected_method TEXT CHECK (selected_method IN ('mercado_pago','bank_transfer','cash')),
  due_at INTEGER,
  paid_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  CHECK ((payer_kind='user' AND payer_user_id IS NOT NULL) OR (payer_kind='manual_profile' AND payer_profile_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS payment_orders_tournament_idx ON payment_orders(tournament_id,status,updated_at);
CREATE INDEX IF NOT EXISTS payment_orders_user_idx ON payment_orders(payer_user_id,tournament_id,status);
CREATE INDEX IF NOT EXISTS payment_orders_profile_idx ON payment_orders(payer_profile_id,tournament_id,status);
CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_open_user_uq
  ON payment_orders(tournament_id,payer_user_id)
  WHERE payer_kind='user' AND status IN ('draft','awaiting_payment');
CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_open_profile_uq
  ON payment_orders(tournament_id,payer_profile_id)
  WHERE payer_kind='manual_profile' AND status IN ('draft','awaiting_payment');

CREATE TABLE IF NOT EXISTS payment_order_items (
  id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE,
  registration_id TEXT REFERENCES tournament_registrations(id) ON DELETE SET NULL,
  player_profile_id TEXT REFERENCES tournament_player_profiles(id) ON DELETE SET NULL,
  category_id TEXT REFERENCES tournament_categories(id) ON DELETE SET NULL,
  label TEXT NOT NULL,
  amount_minor INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  CHECK (registration_id IS NOT NULL OR (player_profile_id IS NOT NULL AND category_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS payment_order_items_order_idx ON payment_order_items(order_id);
CREATE INDEX IF NOT EXISTS payment_order_items_registration_idx ON payment_order_items(registration_id);
CREATE INDEX IF NOT EXISTS payment_order_items_profile_idx ON payment_order_items(player_profile_id,category_id);

CREATE TABLE IF NOT EXISTS payment_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('mercado_pago','bank_transfer','cash')),
  status TEXT NOT NULL CHECK (status IN ('created','pending','submitted','approved','rejected','cancelled','refunded')),
  amount_minor INTEGER NOT NULL,
  external_id TEXT,
  external_status TEXT,
  external_reference TEXT,
  idempotency_key TEXT,
  note TEXT,
  submitted_by_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  reviewed_by_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  submitted_at INTEGER,
  reviewed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS payment_attempts_order_idx ON payment_attempts(order_id,created_at);
CREATE INDEX IF NOT EXISTS payment_attempts_external_idx ON payment_attempts(method,external_id);
CREATE UNIQUE INDEX IF NOT EXISTS payment_attempts_idempotency_uq ON payment_attempts(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment_proofs (
  id TEXT PRIMARY KEY NOT NULL,
  attempt_id TEXT NOT NULL REFERENCES payment_attempts(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  uploaded_by_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  uploaded_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS payment_proofs_attempt_idx ON payment_proofs(attempt_id,uploaded_at);

CREATE TABLE IF NOT EXISTS payment_events (
  id TEXT PRIMARY KEY NOT NULL,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  order_id TEXT REFERENCES payment_orders(id) ON DELETE SET NULL,
  attempt_id TEXT REFERENCES payment_attempts(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  provider_event_id TEXT,
  actor_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  summary TEXT NOT NULL,
  metadata_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS payment_events_tournament_idx ON payment_events(tournament_id,created_at);
CREATE INDEX IF NOT EXISTS payment_events_order_idx ON payment_events(order_id,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS payment_events_provider_event_uq ON payment_events(provider_event_id) WHERE provider_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment_oauth_states (
  id TEXT PRIMARY KEY NOT NULL,
  state TEXT NOT NULL UNIQUE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  initiated_by_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  code_verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS payment_oauth_states_expiry_idx ON payment_oauth_states(expires_at,consumed_at);

CREATE TABLE IF NOT EXISTS registration_cancellation_requests (
  id TEXT PRIMARY KEY NOT NULL,
  registration_id TEXT NOT NULL REFERENCES tournament_registrations(id) ON DELETE CASCADE,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  requested_by_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','cancelled')),
  reason TEXT,
  net_paid_minor INTEGER NOT NULL DEFAULT 0,
  refund_amount_minor INTEGER NOT NULL DEFAULT 0,
  admin_note TEXT,
  reviewed_by_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  reviewed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS registration_cancellation_requests_tournament_idx ON registration_cancellation_requests(tournament_id,status,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS registration_cancellation_requests_pending_uq ON registration_cancellation_requests(registration_id) WHERE status='pending';

CREATE TABLE IF NOT EXISTS payment_refunds (
  id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE,
  registration_id TEXT REFERENCES tournament_registrations(id) ON DELETE SET NULL,
  amount_minor INTEGER NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('mercado_pago','bank_transfer','cash','other')),
  status TEXT NOT NULL CHECK (status IN ('pending','completed','rejected')),
  external_id TEXT,
  note TEXT,
  created_by_user_id TEXT NOT NULL REFERENCES user(id),
  completed_by_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS payment_refunds_order_idx ON payment_refunds(order_id,status,created_at);
CREATE INDEX IF NOT EXISTS payment_refunds_registration_idx ON payment_refunds(registration_id,status,created_at);

INSERT INTO app_meta(key,value,updated_at)
VALUES('schema_version','phase7-payments',CAST(strftime('%s','now') AS INTEGER))
ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
