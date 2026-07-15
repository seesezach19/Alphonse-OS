CREATE TABLE diagnostic_repair_delivery_bindings (
  binding_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  adapter_id text NOT NULL,
  adapter_version text NOT NULL,
  target jsonb NOT NULL CHECK (jsonb_typeof(target) = 'object'),
  external_credential_binding_ref text NOT NULL,
  permitted_operations jsonb NOT NULL CHECK (jsonb_typeof(permitted_operations) = 'array'),
  transition_policy jsonb NOT NULL CHECK (jsonb_typeof(transition_policy) = 'object'),
  binding_digest text NOT NULL CHECK (binding_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_by_actor_type text NOT NULL,
  created_by_actor_id text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (installation_id, binding_digest)
);

CREATE TABLE diagnostic_repair_deliveries (
  delivery_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  candidate_id uuid NOT NULL UNIQUE REFERENCES diagnostic_repair_candidates(candidate_id),
  binding_id uuid NOT NULL REFERENCES diagnostic_repair_delivery_bindings(binding_id),
  delivery_request_digest text NOT NULL CHECK (delivery_request_digest ~ '^sha256:[0-9a-f]{64}$'),
  expected_base_revision_digest text NOT NULL CHECK (expected_base_revision_digest ~ '^sha256:[0-9a-f]{64}$'),
  actual_base_revision_digest text NOT NULL CHECK (actual_base_revision_digest ~ '^sha256:[0-9a-f]{64}$'),
  base_snapshot_artifact_digest text NOT NULL,
  target_candidate_id text NOT NULL,
  target_candidate_revision_digest text NOT NULL CHECK (target_candidate_revision_digest ~ '^sha256:[0-9a-f]{64}$'),
  target_candidate_artifact_digest text NOT NULL,
  target_candidate_state text NOT NULL CHECK (target_candidate_state = 'inactive'),
  adapter_receipt jsonb NOT NULL CHECK (jsonb_typeof(adapter_receipt) = 'object'),
  adapter_receipt_digest text NOT NULL CHECK (adapter_receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  idempotency_key text NOT NULL,
  active_target_confirmed_unchanged boolean NOT NULL CHECK (active_target_confirmed_unchanged),
  created_by_actor_type text NOT NULL,
  created_by_actor_id text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (installation_id, binding_id, idempotency_key),
  FOREIGN KEY (installation_id, base_snapshot_artifact_digest)
    REFERENCES diagnostic_artifacts(installation_id, artifact_digest),
  FOREIGN KEY (installation_id, target_candidate_artifact_digest)
    REFERENCES diagnostic_artifacts(installation_id, artifact_digest)
);

CREATE INDEX diagnostic_repair_delivery_bindings_target_idx
  ON diagnostic_repair_delivery_bindings (installation_id, adapter_id, adapter_version, created_at);
CREATE INDEX diagnostic_repair_deliveries_candidate_idx
  ON diagnostic_repair_deliveries (installation_id, candidate_id, created_at);

CREATE TRIGGER diagnostic_repair_delivery_bindings_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_repair_delivery_bindings
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_repair_deliveries_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_repair_deliveries
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
