ALTER TABLE diagnostic_coverage_onboarding_events
  DROP CONSTRAINT diagnostic_coverage_onboarding_events_event_type_check;
ALTER TABLE diagnostic_coverage_onboarding_events
  ADD CONSTRAINT diagnostic_coverage_onboarding_events_event_type_check CHECK (event_type IN (
    'opened', 'evidence_captured', 'evidence_reused', 'snapshot_replaced',
    'interpretation_submitted', 'ambiguities_projected', 'ambiguity_resolved'
  ));

CREATE TABLE diagnostic_coverage_interpretation_assignments (
  assignment_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  onboarding_id uuid NOT NULL,
  snapshot_digest text NOT NULL CHECK (snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
  onboarding_revision bigint NOT NULL CHECK (onboarding_revision >= 2),
  event_head_digest text NOT NULL CHECK (event_head_digest ~ '^sha256:[0-9a-f]{64}$'),
  passport_id uuid NOT NULL,
  agent_principal_id uuid NOT NULL,
  work_intent_id uuid NOT NULL,
  work_intent_digest text NOT NULL CHECK (work_intent_digest ~ '^sha256:[0-9a-f]{64}$'),
  assignment_document jsonb NOT NULL CHECK (jsonb_typeof(assignment_document) = 'object'),
  assignment_digest text NOT NULL CHECK (assignment_digest ~ '^sha256:[0-9a-f]{64}$'),
  assigned_by_principal_id text NOT NULL,
  executed_by_actor_type text NOT NULL,
  executed_by_actor_id text NOT NULL,
  assigned_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  UNIQUE (installation_id, assignment_digest),
  FOREIGN KEY (installation_id, onboarding_id)
    REFERENCES diagnostic_coverage_onboardings(installation_id, onboarding_id),
  FOREIGN KEY (installation_id, onboarding_id, snapshot_digest)
    REFERENCES diagnostic_workflow_discovery_snapshots(installation_id, onboarding_id, snapshot_digest)
);

CREATE TABLE diagnostic_workflow_interpretations (
  interpretation_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  onboarding_id uuid NOT NULL,
  assignment_id uuid NOT NULL UNIQUE REFERENCES diagnostic_coverage_interpretation_assignments(assignment_id),
  snapshot_digest text NOT NULL CHECK (snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
  base_onboarding_revision bigint NOT NULL CHECK (base_onboarding_revision >= 2),
  base_event_head_digest text NOT NULL CHECK (base_event_head_digest ~ '^sha256:[0-9a-f]{64}$'),
  interpretation_digest text NOT NULL CHECK (interpretation_digest ~ '^sha256:[0-9a-f]{64}$'),
  claims_digest text NOT NULL CHECK (claims_digest ~ '^sha256:[0-9a-f]{64}$'),
  claim_index jsonb NOT NULL CHECK (jsonb_typeof(claim_index) = 'array'),
  ambiguity_manifest_digest text NOT NULL CHECK (ambiguity_manifest_digest ~ '^sha256:[0-9a-f]{64}$'),
  supersedes_interpretation_digest text CHECK (
    supersedes_interpretation_digest IS NULL OR supersedes_interpretation_digest ~ '^sha256:[0-9a-f]{64}$'),
  event_index bigint NOT NULL CHECK (event_index >= 3),
  submitted_by_agent_principal_id uuid NOT NULL,
  proposed_at timestamptz NOT NULL,
  accepted_at timestamptz NOT NULL,
  UNIQUE (installation_id, onboarding_id, interpretation_digest),
  UNIQUE (installation_id, onboarding_id, event_index),
  FOREIGN KEY (installation_id, onboarding_id)
    REFERENCES diagnostic_coverage_onboardings(installation_id, onboarding_id),
  FOREIGN KEY (installation_id, interpretation_digest)
    REFERENCES diagnostic_artifacts(installation_id, artifact_digest),
  FOREIGN KEY (installation_id, onboarding_id, snapshot_digest)
    REFERENCES diagnostic_workflow_discovery_snapshots(installation_id, onboarding_id, snapshot_digest)
);

CREATE TABLE diagnostic_coverage_ambiguities (
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  onboarding_id uuid NOT NULL,
  interpretation_digest text NOT NULL,
  ambiguity_id text NOT NULL,
  ambiguity_digest text NOT NULL CHECK (ambiguity_digest ~ '^sha256:[0-9a-f]{64}$'),
  ambiguity_document jsonb NOT NULL CHECK (jsonb_typeof(ambiguity_document) = 'object'),
  blocking boolean NOT NULL,
  projected_event_index bigint NOT NULL CHECK (projected_event_index >= 4),
  projected_at timestamptz NOT NULL,
  PRIMARY KEY (installation_id, onboarding_id, ambiguity_digest),
  UNIQUE (installation_id, onboarding_id, interpretation_digest, ambiguity_id),
  FOREIGN KEY (installation_id, onboarding_id, interpretation_digest)
    REFERENCES diagnostic_workflow_interpretations(installation_id, onboarding_id, interpretation_digest)
);

CREATE TABLE diagnostic_coverage_ambiguity_resolutions (
  resolution_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  onboarding_id uuid NOT NULL,
  ambiguity_digest text NOT NULL,
  confirmation_document jsonb NOT NULL CHECK (jsonb_typeof(confirmation_document) = 'object'),
  confirmation_digest text NOT NULL CHECK (confirmation_digest ~ '^sha256:[0-9a-f]{64}$'),
  resolution_document jsonb NOT NULL CHECK (jsonb_typeof(resolution_document) = 'object'),
  resolution_digest text NOT NULL CHECK (resolution_digest ~ '^sha256:[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('resolved', 'accepted_nonblocking_unknown')),
  resolved_event_index bigint NOT NULL CHECK (resolved_event_index >= 5),
  resolved_by_principal_id text NOT NULL,
  executed_by_actor_type text NOT NULL,
  executed_by_actor_id text NOT NULL,
  resolved_at timestamptz NOT NULL,
  UNIQUE (installation_id, onboarding_id, ambiguity_digest),
  UNIQUE (installation_id, confirmation_digest),
  UNIQUE (installation_id, resolution_digest),
  FOREIGN KEY (installation_id, onboarding_id, ambiguity_digest)
    REFERENCES diagnostic_coverage_ambiguities(installation_id, onboarding_id, ambiguity_digest)
);

CREATE INDEX diagnostic_coverage_interpretation_assignment_idx
  ON diagnostic_coverage_interpretation_assignments
  (installation_id, onboarding_id, snapshot_digest, assigned_at, assignment_id);
CREATE INDEX diagnostic_workflow_interpretation_idx
  ON diagnostic_workflow_interpretations
  (installation_id, onboarding_id, event_index, interpretation_digest);
CREATE INDEX diagnostic_coverage_ambiguity_idx
  ON diagnostic_coverage_ambiguities
  (installation_id, onboarding_id, interpretation_digest, blocking, ambiguity_id);

CREATE TRIGGER diagnostic_coverage_interpretation_assignments_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_coverage_interpretation_assignments
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_workflow_interpretations_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_workflow_interpretations
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_coverage_ambiguities_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_coverage_ambiguities
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_coverage_ambiguity_resolutions_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_coverage_ambiguity_resolutions
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
