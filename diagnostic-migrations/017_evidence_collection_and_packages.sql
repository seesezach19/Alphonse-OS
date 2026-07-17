CREATE TABLE diagnostic_evidence_policy_activations (
  evidence_policy_activation_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  environment_id uuid NOT NULL,
  interpretation_activation_id uuid NOT NULL REFERENCES diagnostic_interpretation_activations(activation_id),
  deployment_id uuid NOT NULL,
  package_version_id uuid NOT NULL,
  package_artifact_digest text NOT NULL CHECK (package_artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  selection_export_id text NOT NULL,
  selection_policy jsonb NOT NULL CHECK (jsonb_typeof(selection_policy) = 'object'),
  selection_policy_digest text NOT NULL CHECK (selection_policy_digest ~ '^sha256:[0-9a-f]{64}$'),
  retention_export_id text NOT NULL,
  retention_policy jsonb NOT NULL CHECK (jsonb_typeof(retention_policy) = 'object'),
  retention_policy_digest text NOT NULL CHECK (retention_policy_digest ~ '^sha256:[0-9a-f]{64}$'),
  retention_requirements jsonb NOT NULL CHECK (jsonb_typeof(retention_requirements) = 'object'),
  stage_artifact_manifest jsonb NOT NULL CHECK (jsonb_typeof(stage_artifact_manifest) = 'object'),
  stage_artifact_digest text NOT NULL CHECK (stage_artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  selection_rules_digest text NOT NULL CHECK (selection_rules_digest ~ '^sha256:[0-9a-f]{64}$'),
  activation_document jsonb NOT NULL CHECK (jsonb_typeof(activation_document) = 'object'),
  activation_digest text NOT NULL CHECK (activation_digest ~ '^sha256:[0-9a-f]{64}$'),
  activated_by text NOT NULL,
  activated_at timestamptz NOT NULL,
  UNIQUE (installation_id, activation_digest)
);

ALTER TABLE diagnostic_behavior_triggers
  ADD COLUMN evidence_policy_activation_id uuid
    REFERENCES diagnostic_evidence_policy_activations(evidence_policy_activation_id);

CREATE TABLE diagnostic_evidence_collection_leases (
  lease_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  environment_id uuid NOT NULL,
  case_id uuid NOT NULL UNIQUE REFERENCES diagnostic_cases(case_id),
  trigger_id uuid NOT NULL UNIQUE REFERENCES diagnostic_behavior_triggers(trigger_id),
  evidence_policy_activation_id uuid NOT NULL
    REFERENCES diagnostic_evidence_policy_activations(evidence_policy_activation_id),
  collection_deadline timestamptz NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  lease_document jsonb NOT NULL CHECK (jsonb_typeof(lease_document) = 'object'),
  lease_digest text NOT NULL CHECK (lease_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  CHECK (lease_expires_at >= collection_deadline),
  UNIQUE (installation_id, lease_digest)
);

CREATE TABLE diagnostic_evidence_collection_lease_references (
  lease_id uuid NOT NULL REFERENCES diagnostic_evidence_collection_leases(lease_id),
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  reference_type text NOT NULL,
  reference_id text NOT NULL,
  reference_digest text NOT NULL CHECK (reference_digest ~ '^sha256:[0-9a-f]{64}$'),
  artifact_digest text,
  reference_stage text NOT NULL CHECK (reference_stage IN ('trigger_input','collection_extension')),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (lease_id, reference_type, reference_id),
  FOREIGN KEY (installation_id, artifact_digest)
    REFERENCES diagnostic_artifacts(installation_id, artifact_digest)
);

CREATE TABLE diagnostic_evidence_collection_jobs (
  job_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  environment_id uuid NOT NULL,
  case_id uuid NOT NULL UNIQUE REFERENCES diagnostic_cases(case_id),
  lease_id uuid NOT NULL UNIQUE REFERENCES diagnostic_evidence_collection_leases(lease_id),
  status text NOT NULL CHECK (status IN ('pending','processing','frozen','failed_transition')),
  wake_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_attempt_at timestamptz,
  completed_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE diagnostic_evidence_packages (
  evidence_package_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  environment_id uuid NOT NULL,
  case_id uuid NOT NULL REFERENCES diagnostic_cases(case_id),
  trigger_id uuid NOT NULL REFERENCES diagnostic_behavior_triggers(trigger_id),
  evidence_policy_activation_id uuid NOT NULL
    REFERENCES diagnostic_evidence_policy_activations(evidence_policy_activation_id),
  revision_number bigint NOT NULL CHECK (revision_number >= 1),
  committed_intake_cutoff bigint NOT NULL CHECK (committed_intake_cutoff >= 1),
  freeze_reason text NOT NULL CHECK (freeze_reason IN ('required_sources_complete','collection_deadline')),
  semantic_package jsonb NOT NULL CHECK (jsonb_typeof(semantic_package) = 'object'),
  semantic_digest text NOT NULL CHECK (semantic_digest ~ '^sha256:[0-9a-f]{64}$'),
  package_artifact_digest text NOT NULL,
  selection_artifact_digest text NOT NULL CHECK (selection_artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  selection_rules_digest text NOT NULL CHECK (selection_rules_digest ~ '^sha256:[0-9a-f]{64}$'),
  record_document jsonb NOT NULL CHECK (jsonb_typeof(record_document) = 'object'),
  record_digest text NOT NULL CHECK (record_digest ~ '^sha256:[0-9a-f]{64}$'),
  frozen_by text NOT NULL,
  frozen_at timestamptz NOT NULL,
  UNIQUE (installation_id, case_id, revision_number),
  UNIQUE (installation_id, semantic_digest),
  UNIQUE (installation_id, package_artifact_digest),
  UNIQUE (installation_id, record_digest),
  FOREIGN KEY (installation_id, package_artifact_digest)
    REFERENCES diagnostic_artifacts(installation_id, artifact_digest)
);

CREATE TABLE diagnostic_artifact_retention_pins (
  pin_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  evidence_package_id uuid NOT NULL REFERENCES diagnostic_evidence_packages(evidence_package_id),
  object_type text NOT NULL,
  object_id text NOT NULL,
  object_digest text NOT NULL CHECK (object_digest ~ '^sha256:[0-9a-f]{64}$'),
  artifact_digest text,
  retention_policy_digest text NOT NULL CHECK (retention_policy_digest ~ '^sha256:[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (evidence_package_id, object_type, object_id),
  FOREIGN KEY (installation_id, artifact_digest)
    REFERENCES diagnostic_artifacts(installation_id, artifact_digest)
);

CREATE TABLE diagnostic_evidence_collection_lease_releases (
  lease_id uuid PRIMARY KEY REFERENCES diagnostic_evidence_collection_leases(lease_id),
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  evidence_package_id uuid NOT NULL UNIQUE REFERENCES diagnostic_evidence_packages(evidence_package_id),
  release_document jsonb NOT NULL CHECK (jsonb_typeof(release_document) = 'object'),
  release_digest text NOT NULL CHECK (release_digest ~ '^sha256:[0-9a-f]{64}$'),
  released_at timestamptz NOT NULL,
  UNIQUE (installation_id, release_digest)
);

CREATE INDEX diagnostic_evidence_collection_job_wakeup_idx
  ON diagnostic_evidence_collection_jobs (status, wake_at, job_id);
CREATE INDEX diagnostic_evidence_collection_reference_idx
  ON diagnostic_evidence_collection_lease_references (installation_id, reference_digest);
CREATE INDEX diagnostic_evidence_package_case_idx
  ON diagnostic_evidence_packages (installation_id, case_id, revision_number);
CREATE INDEX diagnostic_artifact_retention_pin_object_idx
  ON diagnostic_artifact_retention_pins (installation_id, object_digest, expires_at);

CREATE TRIGGER diagnostic_evidence_policy_activations_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_evidence_policy_activations
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_evidence_collection_leases_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_evidence_collection_leases
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_evidence_collection_lease_references_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_evidence_collection_lease_references
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_evidence_packages_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_evidence_packages
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_artifact_retention_pins_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_artifact_retention_pins
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_evidence_collection_lease_releases_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_evidence_collection_lease_releases
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
