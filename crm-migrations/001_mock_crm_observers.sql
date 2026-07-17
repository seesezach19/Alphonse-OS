CREATE TABLE crm_gateway_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  next_sequence bigint NOT NULL DEFAULT 1 CHECK (next_sequence > 0)
);

CREATE TABLE crm_gateway_requests (
  request_id uuid PRIMARY KEY,
  forwarding_id uuid NOT NULL UNIQUE,
  journal_sequence bigint NOT NULL UNIQUE,
  logical_operation_id text NOT NULL,
  delivery_id text NOT NULL,
  operation text NOT NULL CHECK (operation = 'create_lead'),
  idempotency_key_equality_token text NOT NULL,
  token_result_receipt_id uuid NOT NULL,
  payload_digest text NOT NULL,
  payload_algorithm text,
  payload_nonce bytea,
  payload_ciphertext bytea,
  payload_authentication_tag bytea,
  received_at timestamptz NOT NULL,
  forwarding_state text NOT NULL CHECK (forwarding_state IN ('pending','processing','retryable_failed','succeeded')),
  transport_status integer,
  transport_response_digest text,
  reporting_state text NOT NULL CHECK (reporting_state IN ('pending','processing','retryable_failed','reported')),
  observation_id uuid NOT NULL UNIQUE,
  observation_receipt_id uuid,
  reported_at timestamptz
);

CREATE TABLE mock_crm_commits (
  commit_id text PRIMARY KEY,
  ledger_sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  resource_id text NOT NULL UNIQUE,
  request_id uuid NOT NULL UNIQUE,
  logical_operation_id text NOT NULL,
  delivery_id text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  operation text NOT NULL CHECK (operation = 'create_lead'),
  lead_digest text NOT NULL,
  committed_at timestamptz NOT NULL
);

INSERT INTO crm_gateway_state (singleton,next_sequence) VALUES (true,1)
ON CONFLICT (singleton) DO NOTHING;

REVOKE ALL ON crm_gateway_state,crm_gateway_requests,mock_crm_commits FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON crm_gateway_state,crm_gateway_requests TO alphonse_crm_gateway;
GRANT SELECT,INSERT ON mock_crm_commits TO alphonse_mock_crm;
GRANT USAGE,SELECT ON SEQUENCE mock_crm_commits_ledger_sequence_seq TO alphonse_mock_crm;

GRANT USAGE,CREATE ON SCHEMA public TO alphonse_crm_gateway,alphonse_mock_crm;
ALTER TABLE crm_gateway_state OWNER TO alphonse_crm_gateway;
ALTER TABLE crm_gateway_requests OWNER TO alphonse_crm_gateway;
ALTER TABLE mock_crm_commits OWNER TO alphonse_mock_crm;
REVOKE CREATE ON SCHEMA public FROM alphonse_crm_gateway,alphonse_mock_crm;
