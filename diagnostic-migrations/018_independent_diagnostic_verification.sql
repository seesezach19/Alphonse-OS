CREATE TABLE diagnostic_stage_artifact_archives (
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  stage_artifact_digest text NOT NULL CHECK (stage_artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  archive_artifact_digest text NOT NULL CHECK (archive_artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  archived_at timestamptz NOT NULL,
  PRIMARY KEY (installation_id, stage_artifact_digest),
  UNIQUE (installation_id, archive_artifact_digest),
  FOREIGN KEY (installation_id, archive_artifact_digest)
    REFERENCES diagnostic_artifacts(installation_id, artifact_digest)
);

CREATE TABLE diagnostic_independent_verification_bundles (
  verification_bundle_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  environment_id uuid NOT NULL,
  evidence_package_id uuid NOT NULL UNIQUE REFERENCES diagnostic_evidence_packages(evidence_package_id),
  committed_intake_cutoff bigint NOT NULL CHECK (committed_intake_cutoff >= 1),
  bundle_artifact_digest text NOT NULL CHECK (bundle_artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  bundle_digest text NOT NULL CHECK (bundle_digest ~ '^sha256:[0-9a-f]{64}$'),
  record_document jsonb NOT NULL CHECK (jsonb_typeof(record_document) = 'object'),
  record_digest text NOT NULL CHECK (record_digest ~ '^sha256:[0-9a-f]{64}$'),
  exported_by text NOT NULL,
  exported_at timestamptz NOT NULL,
  UNIQUE (installation_id, bundle_artifact_digest),
  UNIQUE (installation_id, bundle_digest),
  FOREIGN KEY (installation_id, bundle_artifact_digest)
    REFERENCES diagnostic_artifacts(installation_id, artifact_digest)
);

CREATE TRIGGER diagnostic_stage_artifact_archives_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_stage_artifact_archives
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_independent_verification_bundles_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_independent_verification_bundles
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
