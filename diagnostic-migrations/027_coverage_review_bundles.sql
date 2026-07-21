ALTER TABLE diagnostic_coverage_onboarding_events
  DROP CONSTRAINT diagnostic_coverage_onboarding_events_event_type_check;
ALTER TABLE diagnostic_coverage_onboarding_events
  ADD CONSTRAINT diagnostic_coverage_onboarding_events_event_type_check CHECK (event_type IN (
    'opened', 'evidence_captured', 'evidence_reused', 'snapshot_replaced',
    'interpretation_submitted', 'ambiguities_projected', 'ambiguity_resolved',
    'review_bundle_created', 'review_invalidated'
  ));

CREATE TABLE diagnostic_coverage_review_bundles (
  review_bundle_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  onboarding_id uuid NOT NULL,
  base_onboarding_revision bigint NOT NULL CHECK (base_onboarding_revision >= 4),
  base_event_head_digest text NOT NULL CHECK (base_event_head_digest ~ '^sha256:[0-9a-f]{64}$'),
  snapshot_digest text NOT NULL CHECK (snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
  interpretation_digest text NOT NULL CHECK (interpretation_digest ~ '^sha256:[0-9a-f]{64}$'),
  review_bundle_digest text NOT NULL CHECK (review_bundle_digest ~ '^sha256:[0-9a-f]{64}$'),
  confirmation_manifest_digest text NOT NULL CHECK (confirmation_manifest_digest ~ '^sha256:[0-9a-f]{64}$'),
  reference_manifest_digest text NOT NULL CHECK (reference_manifest_digest ~ '^sha256:[0-9a-f]{64}$'),
  event_index bigint NOT NULL CHECK (event_index >= 5),
  created_by_actor_type text NOT NULL,
  created_by_actor_id text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (installation_id, onboarding_id, review_bundle_digest),
  UNIQUE (installation_id, onboarding_id, event_index),
  FOREIGN KEY (installation_id, onboarding_id)
    REFERENCES diagnostic_coverage_onboardings(installation_id, onboarding_id),
  FOREIGN KEY (installation_id, review_bundle_digest)
    REFERENCES diagnostic_artifacts(installation_id, artifact_digest),
  FOREIGN KEY (installation_id, onboarding_id, snapshot_digest)
    REFERENCES diagnostic_workflow_discovery_snapshots(installation_id, onboarding_id, snapshot_digest),
  FOREIGN KEY (installation_id, onboarding_id, interpretation_digest)
    REFERENCES diagnostic_workflow_interpretations(installation_id, onboarding_id, interpretation_digest)
);

CREATE INDEX diagnostic_coverage_review_bundle_idx
  ON diagnostic_coverage_review_bundles
  (installation_id, onboarding_id, event_index, review_bundle_digest);

CREATE TRIGGER diagnostic_coverage_review_bundles_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_coverage_review_bundles
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
