ALTER TABLE kernel_build_sessions
  ADD CONSTRAINT kernel_build_sessions_identity_binding_unique
    UNIQUE (installation_id, environment_id, build_session_id, passport_id, work_intent_id);

CREATE TABLE kernel_trusted_artifact_attestations (
  artifact_attestation_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  artifact_ref text NOT NULL,
  artifact_digest text NOT NULL CHECK (artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  build_attestation_digest text NOT NULL CHECK (build_attestation_digest ~ '^sha256:[0-9a-f]{64}$'),
  trusted_by_principal_id uuid NOT NULL,
  attested_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, artifact_attestation_id),
  UNIQUE (installation_id, environment_id, artifact_ref, artifact_digest, build_attestation_digest),
  FOREIGN KEY (installation_id, environment_id, trusted_by_principal_id)
    REFERENCES kernel_principals(installation_id, environment_id, principal_id)
);

CREATE TABLE kernel_package_validation_receipts (
  validation_receipt_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  build_session_id uuid NOT NULL,
  passport_id uuid NOT NULL,
  work_intent_id uuid NOT NULL,
  candidate_digest text NOT NULL CHECK (candidate_digest ~ '^sha256:[0-9a-f]{64}$'),
  manifest_digest text NOT NULL CHECK (manifest_digest ~ '^sha256:[0-9a-f]{64}$'),
  toolkit_digest text NOT NULL CHECK (toolkit_digest ~ '^sha256:[0-9a-f]{64}$'),
  validator_version text NOT NULL,
  valid boolean NOT NULL,
  checks jsonb NOT NULL CHECK (jsonb_typeof(checks) = 'array'),
  issues jsonb NOT NULL CHECK (jsonb_typeof(issues) = 'array'),
  validated_by_principal_id uuid NOT NULL,
  validated_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, validation_receipt_id),
  FOREIGN KEY (installation_id, environment_id, build_session_id, passport_id, work_intent_id)
    REFERENCES kernel_build_sessions(installation_id, environment_id, build_session_id, passport_id, work_intent_id),
  FOREIGN KEY (installation_id, environment_id, validated_by_principal_id)
    REFERENCES kernel_principals(installation_id, environment_id, principal_id)
);

CREATE TABLE kernel_package_simulation_receipts (
  simulation_receipt_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  validation_receipt_id uuid NOT NULL,
  candidate_digest text NOT NULL CHECK (candidate_digest ~ '^sha256:[0-9a-f]{64}$'),
  mode text NOT NULL CHECK (mode IN ('deterministic_fixture', 'observational_read_only')),
  context_receipt_id uuid,
  input_digest text NOT NULL CHECK (input_digest ~ '^sha256:[0-9a-f]{64}$'),
  result_digest text NOT NULL CHECK (result_digest ~ '^sha256:[0-9a-f]{64}$'),
  fidelity text NOT NULL,
  assumptions jsonb NOT NULL CHECK (jsonb_typeof(assumptions) = 'array'),
  limitations jsonb NOT NULL CHECK (jsonb_typeof(limitations) = 'array'),
  attester_id text,
  attestation_signature text CHECK (attestation_signature IS NULL OR attestation_signature ~ '^hmac-sha256:[0-9a-f]{64}$'),
  passed boolean NOT NULL,
  simulated_by_principal_id uuid NOT NULL,
  simulated_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, simulation_receipt_id),
  FOREIGN KEY (installation_id, environment_id, validation_receipt_id)
    REFERENCES kernel_package_validation_receipts(installation_id, environment_id, validation_receipt_id),
  FOREIGN KEY (installation_id, environment_id, context_receipt_id)
    REFERENCES kernel_context_receipts(installation_id, environment_id, receipt_id),
  FOREIGN KEY (installation_id, environment_id, simulated_by_principal_id)
    REFERENCES kernel_principals(installation_id, environment_id, principal_id)
);

CREATE TABLE kernel_package_versions (
  package_version_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  package_id text NOT NULL,
  semantic_version text NOT NULL,
  artifact_digest text NOT NULL CHECK (artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  manifest_digest text NOT NULL CHECK (manifest_digest ~ '^sha256:[0-9a-f]{64}$'),
  dependency_digest text NOT NULL CHECK (dependency_digest ~ '^sha256:[0-9a-f]{64}$'),
  canonicalization_version text NOT NULL,
  candidate jsonb NOT NULL CHECK (jsonb_typeof(candidate) = 'object'),
  normalized_exports jsonb NOT NULL CHECK (jsonb_typeof(normalized_exports) = 'array'),
  build_session_id uuid NOT NULL,
  validation_receipt_id uuid NOT NULL,
  simulation_receipt_ids jsonb NOT NULL CHECK (jsonb_typeof(simulation_receipt_ids) = 'array'),
  toolkit_digest text NOT NULL CHECK (toolkit_digest ~ '^sha256:[0-9a-f]{64}$'),
  publisher_principal_id uuid NOT NULL,
  validator_version text NOT NULL,
  publication_key_id text NOT NULL,
  publication_signature text NOT NULL CHECK (publication_signature ~ '^hmac-sha256:[0-9a-f]{64}$'),
  published_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, package_version_id),
  UNIQUE (installation_id, environment_id, package_id, semantic_version),
  UNIQUE (installation_id, environment_id, package_id, artifact_digest),
  FOREIGN KEY (installation_id, environment_id, build_session_id)
    REFERENCES kernel_build_sessions(installation_id, environment_id, build_session_id),
  FOREIGN KEY (installation_id, environment_id, validation_receipt_id)
    REFERENCES kernel_package_validation_receipts(installation_id, environment_id, validation_receipt_id),
  FOREIGN KEY (installation_id, environment_id, publisher_principal_id)
    REFERENCES kernel_principals(installation_id, environment_id, principal_id)
);

CREATE INDEX kernel_package_versions_identity_idx
  ON kernel_package_versions (installation_id, environment_id, package_id, semantic_version);

CREATE TRIGGER kernel_package_validation_receipts_immutable BEFORE UPDATE OR DELETE ON kernel_package_validation_receipts
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_package_simulation_receipts_immutable BEFORE UPDATE OR DELETE ON kernel_package_simulation_receipts
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_package_versions_immutable BEFORE UPDATE OR DELETE ON kernel_package_versions
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_trusted_artifact_attestations_immutable BEFORE UPDATE OR DELETE ON kernel_trusted_artifact_attestations
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
