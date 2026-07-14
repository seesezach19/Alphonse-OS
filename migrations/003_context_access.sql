CREATE TABLE kernel_context_access_grants (
  grant_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  passport_id uuid NOT NULL,
  work_intent_id uuid NOT NULL,
  agent_principal_id uuid NOT NULL,
  purpose text NOT NULL,
  subjects jsonb NOT NULL,
  sources jsonb NOT NULL,
  sensitivity_classes jsonb NOT NULL,
  max_items integer NOT NULL CHECK (max_items BETWEEN 1 AND 1000),
  max_age_seconds integer NOT NULL CHECK (max_age_seconds BETWEEN 1 AND 86400),
  expires_at timestamptz NOT NULL,
  issued_by_principal_id uuid NOT NULL,
  issued_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, grant_id),
  FOREIGN KEY (installation_id, environment_id, passport_id, agent_principal_id)
    REFERENCES kernel_agent_passports(installation_id, environment_id, passport_id, agent_principal_id),
  FOREIGN KEY (installation_id, environment_id, work_intent_id, passport_id, agent_principal_id)
    REFERENCES kernel_work_intents(installation_id, environment_id, work_intent_id, passport_id, agent_principal_id),
  FOREIGN KEY (installation_id, environment_id, issued_by_principal_id)
    REFERENCES kernel_principals(installation_id, environment_id, principal_id)
);

CREATE TABLE kernel_context_receipts (
  receipt_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  data_plane_id text NOT NULL,
  recipient_principal_id uuid NOT NULL,
  packet_hash text NOT NULL CHECK (packet_hash ~ '^sha256:[0-9a-f]{64}$'),
  item_references jsonb NOT NULL,
  authority_claims jsonb NOT NULL,
  freshness_claims jsonb NOT NULL,
  provenance jsonb NOT NULL,
  limitations jsonb NOT NULL,
  delivered_at timestamptz NOT NULL,
  signature text NOT NULL CHECK (signature ~ '^hmac-sha256:[0-9a-f]{64}$'),
  UNIQUE (installation_id, environment_id, receipt_id),
  FOREIGN KEY (installation_id, environment_id, grant_id)
    REFERENCES kernel_context_access_grants(installation_id, environment_id, grant_id),
  FOREIGN KEY (installation_id, environment_id, recipient_principal_id)
    REFERENCES kernel_principals(installation_id, environment_id, principal_id)
);

CREATE INDEX kernel_context_receipts_grant_idx
  ON kernel_context_receipts (installation_id, environment_id, grant_id, delivered_at DESC);

CREATE TRIGGER kernel_context_access_grants_immutable BEFORE UPDATE OR DELETE ON kernel_context_access_grants
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_context_receipts_immutable BEFORE UPDATE OR DELETE ON kernel_context_receipts
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
