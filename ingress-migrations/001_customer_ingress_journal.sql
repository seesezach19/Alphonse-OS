CREATE TABLE ingress_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  next_journal_sequence bigint NOT NULL DEFAULT 1 CHECK (next_journal_sequence > 0),
  updated_at timestamptz NOT NULL
);

CREATE TABLE ingress_source_mappings (
  mapping_id uuid PRIMARY KEY,
  source_binding_id text NOT NULL,
  source_identity_token text NOT NULL,
  logical_operation_id text NOT NULL UNIQUE,
  mapping_receipt_id uuid NOT NULL UNIQUE,
  first_journal_sequence bigint NOT NULL CHECK (first_journal_sequence > 0),
  first_journal_record_digest text NOT NULL CHECK (first_journal_record_digest ~ '^sha256:[0-9a-f]{64}$'),
  signed_mapping_receipt_bytes bytea NOT NULL,
  mapping_receipt_digest text NOT NULL CHECK (mapping_receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_token_result_receipt_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (source_binding_id, source_identity_token)
);

CREATE TABLE ingress_delivery_attempts (
  delivery_id uuid PRIMARY KEY,
  journal_sequence bigint NOT NULL UNIQUE CHECK (journal_sequence > 0),
  mapping_id uuid NOT NULL REFERENCES ingress_source_mappings(mapping_id),
  logical_operation_id text NOT NULL,
  source_binding_id text NOT NULL,
  source_identity_token text NOT NULL,
  delivery_identity_equality_token text NOT NULL,
  source_token_result_receipt_id uuid NOT NULL,
  delivery_token_result_receipt_id uuid NOT NULL,
  observation_id uuid NOT NULL UNIQUE,
  forwarding_id uuid NOT NULL UNIQUE,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  payload_digest text NOT NULL CHECK (payload_digest ~ '^sha256:[0-9a-f]{64}$'),
  payload_algorithm text CHECK (payload_algorithm = 'aes-256-gcm'),
  payload_nonce bytea,
  payload_ciphertext bytea,
  payload_authentication_tag bytea,
  payload_plaintext_size bigint NOT NULL CHECK (payload_plaintext_size >= 0),
  journal_record_digest text NOT NULL CHECK (journal_record_digest ~ '^sha256:[0-9a-f]{64}$'),
  redacted_claims jsonb NOT NULL CHECK (jsonb_typeof(redacted_claims) = 'object'),
  forwarding_state text NOT NULL CHECK (forwarding_state IN ('pending','processing','retryable_failed','succeeded')),
  forwarding_attempt_count integer NOT NULL DEFAULT 0 CHECK (forwarding_attempt_count >= 0),
  forwarding_next_attempt_at timestamptz,
  forwarding_lease_expires_at timestamptz,
  forwarding_response_status integer,
  forwarding_response_digest text,
  forwarded_at timestamptz,
  reporting_state text NOT NULL CHECK (reporting_state IN ('pending','processing','retryable_failed','reported')),
  reporting_attempt_count integer NOT NULL DEFAULT 0 CHECK (reporting_attempt_count >= 0),
  reporting_next_attempt_at timestamptz,
  reporting_lease_expires_at timestamptz,
  observation_receipt_id uuid,
  observation_receipt_digest text,
  observation_replayed boolean NOT NULL DEFAULT false,
  reported_at timestamptz,
  UNIQUE (source_binding_id, delivery_identity_equality_token)
);

CREATE TABLE ingress_forwarding_attempts (
  attempt_id uuid PRIMARY KEY,
  delivery_id uuid NOT NULL REFERENCES ingress_delivery_attempts(delivery_id),
  forwarding_id uuid NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  outcome text NOT NULL CHECK (outcome IN ('succeeded','retryable_failed')),
  response_status integer,
  response_digest text,
  safe_error_code text,
  occurred_at timestamptz NOT NULL,
  UNIQUE (delivery_id, attempt_number)
);

CREATE TABLE ingress_reporting_attempts (
  attempt_id uuid PRIMARY KEY,
  delivery_id uuid NOT NULL REFERENCES ingress_delivery_attempts(delivery_id),
  observation_id uuid NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  outcome text NOT NULL CHECK (outcome IN ('reported','retryable_failed')),
  response_status integer,
  replayed boolean,
  safe_error_code text,
  occurred_at timestamptz NOT NULL,
  UNIQUE (delivery_id, attempt_number)
);

CREATE TABLE ingress_durable_loss_markers (
  loss_marker_id uuid PRIMARY KEY,
  first_journal_sequence bigint NOT NULL CHECK (first_journal_sequence > 0),
  last_journal_sequence bigint NOT NULL CHECK (last_journal_sequence >= first_journal_sequence),
  reason_code text NOT NULL,
  detail_digest text NOT NULL CHECK (detail_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL
);

CREATE TABLE ingress_test_faults (
  fault_id text PRIMARY KEY,
  consumed_at timestamptz NOT NULL
);

CREATE OR REPLACE FUNCTION ingress_reject_immutable_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'immutable ingress record';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ingress_source_mappings_immutable BEFORE UPDATE OR DELETE ON ingress_source_mappings
  FOR EACH ROW EXECUTE FUNCTION ingress_reject_immutable_mutation();

CREATE OR REPLACE FUNCTION ingress_delivery_identity_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.delivery_id IS DISTINCT FROM OLD.delivery_id
     OR NEW.journal_sequence IS DISTINCT FROM OLD.journal_sequence
     OR NEW.mapping_id IS DISTINCT FROM OLD.mapping_id
     OR NEW.logical_operation_id IS DISTINCT FROM OLD.logical_operation_id
     OR NEW.source_binding_id IS DISTINCT FROM OLD.source_binding_id
     OR NEW.source_identity_token IS DISTINCT FROM OLD.source_identity_token
     OR NEW.delivery_identity_equality_token IS DISTINCT FROM OLD.delivery_identity_equality_token
     OR NEW.source_token_result_receipt_id IS DISTINCT FROM OLD.source_token_result_receipt_id
     OR NEW.delivery_token_result_receipt_id IS DISTINCT FROM OLD.delivery_token_result_receipt_id
     OR NEW.observation_id IS DISTINCT FROM OLD.observation_id
     OR NEW.forwarding_id IS DISTINCT FROM OLD.forwarding_id
     OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
     OR NEW.received_at IS DISTINCT FROM OLD.received_at
     OR NEW.payload_digest IS DISTINCT FROM OLD.payload_digest
     OR NEW.payload_plaintext_size IS DISTINCT FROM OLD.payload_plaintext_size
     OR NEW.journal_record_digest IS DISTINCT FROM OLD.journal_record_digest
     OR NEW.redacted_claims IS DISTINCT FROM OLD.redacted_claims THEN
    RAISE EXCEPTION 'immutable ingress delivery identity';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ingress_delivery_identity_immutable BEFORE UPDATE ON ingress_delivery_attempts
  FOR EACH ROW EXECUTE FUNCTION ingress_delivery_identity_immutable();
CREATE TRIGGER ingress_forwarding_attempts_immutable BEFORE UPDATE OR DELETE ON ingress_forwarding_attempts
  FOR EACH ROW EXECUTE FUNCTION ingress_reject_immutable_mutation();
CREATE TRIGGER ingress_reporting_attempts_immutable BEFORE UPDATE OR DELETE ON ingress_reporting_attempts
  FOR EACH ROW EXECUTE FUNCTION ingress_reject_immutable_mutation();
CREATE TRIGGER ingress_loss_markers_immutable BEFORE UPDATE OR DELETE ON ingress_durable_loss_markers
  FOR EACH ROW EXECUTE FUNCTION ingress_reject_immutable_mutation();

INSERT INTO ingress_state (singleton,next_journal_sequence,updated_at)
VALUES (true,1,now()) ON CONFLICT (singleton) DO NOTHING;
