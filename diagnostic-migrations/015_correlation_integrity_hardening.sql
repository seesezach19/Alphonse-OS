CREATE TABLE diagnostic_intake_outcome_documents (
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  intake_position bigint NOT NULL,
  outcome_type text NOT NULL CHECK (outcome_type IN ('conflict', 'rejected')),
  outcome_id uuid NOT NULL,
  document_format text NOT NULL CHECK (document_format IN (
    'alphonse.observation-conflict.v0.2',
    'alphonse.observation-rejection.v0.2'
  )),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  canonical_document_bytes bytea NOT NULL,
  document_digest text NOT NULL CHECK (document_digest ~ '^sha256:[0-9a-f]{64}$'),
  material_origin text NOT NULL CHECK (material_origin = 'native_v0.2'),
  preserved_at timestamptz NOT NULL,
  PRIMARY KEY (installation_id, intake_position),
  UNIQUE (installation_id, outcome_id),
  UNIQUE (installation_id, document_digest),
  FOREIGN KEY (installation_id, intake_position)
    REFERENCES diagnostic_intake_outcomes(installation_id, intake_position)
);

CREATE TRIGGER diagnostic_intake_outcome_documents_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_intake_outcome_documents
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();

ALTER TABLE diagnostic_correlation_registrations
  ADD COLUMN projector_artifact_manifest jsonb,
  ADD COLUMN projector_input_schema_version text,
  ADD COLUMN projection_schema_version text;

ALTER TABLE diagnostic_correlation_projections
  ADD COLUMN projector_input_schema_version text,
  ADD COLUMN projector_input_digest text CHECK (
    projector_input_digest IS NULL OR projector_input_digest ~ '^sha256:[0-9a-f]{64}$'
  );

ALTER TABLE diagnostic_correlation_projection_conflicts
  ADD COLUMN accepted_projector_input_digest text CHECK (
    accepted_projector_input_digest IS NULL OR accepted_projector_input_digest ~ '^sha256:[0-9a-f]{64}$'
  ),
  ADD COLUMN received_projector_input_digest text CHECK (
    received_projector_input_digest IS NULL OR received_projector_input_digest ~ '^sha256:[0-9a-f]{64}$'
  );
