CREATE TABLE diagnostic_promotions (
  promotion_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  case_id uuid NOT NULL REFERENCES diagnostic_cases(case_id),
  candidate_id uuid NOT NULL UNIQUE REFERENCES diagnostic_repair_candidates(candidate_id),
  delivery_id uuid NOT NULL UNIQUE REFERENCES diagnostic_repair_deliveries(delivery_id),
  verification_id uuid NOT NULL UNIQUE REFERENCES diagnostic_verification_receipts(verification_id),
  binding_id uuid NOT NULL REFERENCES diagnostic_repair_delivery_bindings(binding_id),
  authorization_digest text NOT NULL CHECK (authorization_digest ~ '^sha256:[0-9a-f]{64}$'),
  expected_target_revision_digest text NOT NULL CHECK (expected_target_revision_digest ~ '^sha256:[0-9a-f]{64}$'),
  candidate_target_revision_digest text NOT NULL CHECK (candidate_target_revision_digest ~ '^sha256:[0-9a-f]{64}$'),
  verification_receipt_digest text NOT NULL CHECK (verification_receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  owner_actor_type text NOT NULL CHECK (owner_actor_type = 'human'),
  owner_actor_id text NOT NULL,
  idempotency_key text NOT NULL,
  authorized_at timestamptz NOT NULL,
  UNIQUE (installation_id, authorization_digest),
  UNIQUE (installation_id, idempotency_key)
);

CREATE TABLE diagnostic_promotion_events (
  event_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  promotion_id uuid NOT NULL REFERENCES diagnostic_promotions(promotion_id),
  event_index bigint NOT NULL CHECK (event_index >= 1),
  event_type text NOT NULL CHECK (event_type IN (
    'authorized','application_requested','applying','uncertain','confirmed','failed',
    'target_mismatch','rollback_authorized','rolled_back'
  )),
  detail jsonb NOT NULL CHECK (jsonb_typeof(detail) = 'object'),
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  UNIQUE (installation_id, promotion_id, event_index)
);

CREATE TABLE diagnostic_promotion_idempotency (
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  idempotency_key text NOT NULL,
  request_digest text NOT NULL CHECK (request_digest ~ '^sha256:[0-9a-f]{64}$'),
  promotion_id uuid NOT NULL REFERENCES diagnostic_promotions(promotion_id),
  bound_at timestamptz NOT NULL,
  PRIMARY KEY (installation_id, idempotency_key)
);

CREATE TABLE diagnostic_promotion_apply_idempotency (
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  idempotency_key text NOT NULL,
  request_digest text NOT NULL CHECK (request_digest ~ '^sha256:[0-9a-f]{64}$'),
  promotion_id uuid NOT NULL REFERENCES diagnostic_promotions(promotion_id),
  bound_at timestamptz NOT NULL,
  PRIMARY KEY (installation_id, idempotency_key)
);

CREATE TABLE diagnostic_promotion_reconciliation_idempotency (
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  idempotency_key text NOT NULL,
  request_digest text NOT NULL CHECK (request_digest ~ '^sha256:[0-9a-f]{64}$'),
  promotion_id uuid NOT NULL REFERENCES diagnostic_promotions(promotion_id),
  bound_at timestamptz NOT NULL,
  PRIMARY KEY (installation_id, idempotency_key)
);

CREATE TABLE diagnostic_promotion_rollback_idempotency (
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  idempotency_key text NOT NULL,
  request_digest text NOT NULL CHECK (request_digest ~ '^sha256:[0-9a-f]{64}$'),
  promotion_id uuid NOT NULL REFERENCES diagnostic_promotions(promotion_id),
  bound_at timestamptz NOT NULL,
  PRIMARY KEY (installation_id, idempotency_key)
);

CREATE INDEX diagnostic_promotions_case_idx
  ON diagnostic_promotions (installation_id, case_id, authorized_at, promotion_id);
CREATE INDEX diagnostic_promotion_events_promotion_idx
  ON diagnostic_promotion_events (installation_id, promotion_id, event_index);

CREATE TRIGGER diagnostic_promotions_immutable BEFORE UPDATE OR DELETE ON diagnostic_promotions
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_promotion_events_immutable BEFORE UPDATE OR DELETE ON diagnostic_promotion_events
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_promotion_idempotency_immutable BEFORE UPDATE OR DELETE ON diagnostic_promotion_idempotency
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_promotion_apply_idempotency_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_promotion_apply_idempotency
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_promotion_reconciliation_idempotency_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_promotion_reconciliation_idempotency
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_promotion_rollback_idempotency_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_promotion_rollback_idempotency
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
