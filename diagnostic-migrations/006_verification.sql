CREATE TABLE diagnostic_verification_receipts (
  verification_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  case_id uuid NOT NULL REFERENCES diagnostic_cases(case_id),
  candidate_id uuid NOT NULL REFERENCES diagnostic_repair_candidates(candidate_id),
  delivery_id uuid NOT NULL REFERENCES diagnostic_repair_deliveries(delivery_id),
  reproduction_bundle_id uuid NOT NULL REFERENCES diagnostic_reproduction_bundles(bundle_id),
  verification_request_digest text NOT NULL CHECK (verification_request_digest ~ '^sha256:[0-9a-f]{64}$'),
  original_artifact_digest text NOT NULL,
  candidate_artifact_digest text NOT NULL,
  bundle_artifact_digest text NOT NULL,
  fixture_artifact_digest text NOT NULL,
  regression_artifact_digests jsonb NOT NULL CHECK (jsonb_typeof(regression_artifact_digests) = 'array'),
  runner_id uuid NOT NULL,
  runner_version text NOT NULL,
  fixture_version text NOT NULL,
  overall_result text NOT NULL CHECK (overall_result IN ('passed','failed')),
  outcomes jsonb NOT NULL CHECK (jsonb_typeof(outcomes) = 'object'),
  logs_artifact_digest text NOT NULL,
  receipt_artifact_digest text NOT NULL,
  receipt_digest text NOT NULL CHECK (receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt) = 'object'),
  environment_destroyed boolean NOT NULL CHECK (environment_destroyed),
  verified_at timestamptz NOT NULL,
  UNIQUE (installation_id, verification_request_digest),
  UNIQUE (installation_id, receipt_digest),
  FOREIGN KEY (installation_id, original_artifact_digest)
    REFERENCES diagnostic_artifacts(installation_id, artifact_digest),
  FOREIGN KEY (installation_id, candidate_artifact_digest)
    REFERENCES diagnostic_artifacts(installation_id, artifact_digest),
  FOREIGN KEY (installation_id, bundle_artifact_digest)
    REFERENCES diagnostic_artifacts(installation_id, artifact_digest),
  FOREIGN KEY (installation_id, fixture_artifact_digest)
    REFERENCES diagnostic_artifacts(installation_id, artifact_digest),
  FOREIGN KEY (installation_id, logs_artifact_digest)
    REFERENCES diagnostic_artifacts(installation_id, artifact_digest),
  FOREIGN KEY (installation_id, receipt_artifact_digest)
    REFERENCES diagnostic_artifacts(installation_id, artifact_digest)
);

CREATE TABLE diagnostic_verification_idempotency (
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  idempotency_key text NOT NULL,
  verification_request_digest text NOT NULL CHECK (verification_request_digest ~ '^sha256:[0-9a-f]{64}$'),
  verification_id uuid NOT NULL REFERENCES diagnostic_verification_receipts(verification_id),
  bound_at timestamptz NOT NULL,
  PRIMARY KEY (installation_id, idempotency_key)
);

CREATE INDEX diagnostic_verification_receipts_case_idx
  ON diagnostic_verification_receipts (installation_id, case_id, verified_at, verification_id);
CREATE INDEX diagnostic_verification_receipts_candidate_idx
  ON diagnostic_verification_receipts (installation_id, candidate_id, verified_at, verification_id);

CREATE TRIGGER diagnostic_verification_receipts_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_verification_receipts
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_verification_idempotency_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_verification_idempotency
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
