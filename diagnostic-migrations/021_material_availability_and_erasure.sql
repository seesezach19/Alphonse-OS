CREATE TABLE diagnostic_material_retention_holds (
  hold_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  environment_id uuid NOT NULL,
  artifact_digest text NOT NULL CHECK (artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  hold_class text NOT NULL CHECK (hold_class IN (
    'active_case','diagnosis','review','audit','legal_hold','worker_run'
  )),
  source_type text NOT NULL,
  source_id text NOT NULL,
  expires_at timestamptz,
  hold_document jsonb NOT NULL CHECK (jsonb_typeof(hold_document) = 'object'),
  hold_digest text NOT NULL CHECK (hold_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (installation_id,artifact_digest,hold_class,source_type,source_id),
  UNIQUE (installation_id,hold_digest),
  FOREIGN KEY (installation_id,artifact_digest)
    REFERENCES diagnostic_artifacts(installation_id,artifact_digest)
);

CREATE TABLE diagnostic_material_retention_hold_releases (
  hold_id uuid PRIMARY KEY REFERENCES diagnostic_material_retention_holds(hold_id),
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  release_document jsonb NOT NULL CHECK (jsonb_typeof(release_document) = 'object'),
  release_digest text NOT NULL CHECK (release_digest ~ '^sha256:[0-9a-f]{64}$'),
  released_by text NOT NULL,
  released_at timestamptz NOT NULL,
  UNIQUE (installation_id,release_digest)
);

CREATE TABLE diagnostic_material_erasure_decisions (
  erasure_decision_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  environment_id uuid NOT NULL,
  artifact_digest text NOT NULL CHECK (artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  material_class text NOT NULL CHECK (material_class IN (
    'package_selected_artifact','diagnostic_evidence_package',
    'independent_verification_bundle','diagnostic_reproduction_bundle'
  )),
  reason_code text NOT NULL CHECK (reason_code IN (
    'privacy_request','security_response','legal_requirement','customer_retention_request'
  )),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  governing_policy jsonb NOT NULL CHECK (jsonb_typeof(governing_policy) = 'object'),
  governing_policy_digest text NOT NULL CHECK (governing_policy_digest ~ '^sha256:[0-9a-f]{64}$'),
  override_retention_classes jsonb NOT NULL CHECK (jsonb_typeof(override_retention_classes) = 'array'),
  impact_manifest jsonb NOT NULL CHECK (jsonb_typeof(impact_manifest) = 'object'),
  impact_manifest_digest text NOT NULL CHECK (impact_manifest_digest ~ '^sha256:[0-9a-f]{64}$'),
  decision_document jsonb NOT NULL CHECK (jsonb_typeof(decision_document) = 'object'),
  decision_digest text NOT NULL CHECK (decision_digest ~ '^sha256:[0-9a-f]{64}$'),
  authorized_by_type text NOT NULL,
  authorized_by_id text NOT NULL,
  authorization_context jsonb NOT NULL CHECK (jsonb_typeof(authorization_context) = 'object'),
  requested_at timestamptz NOT NULL,
  UNIQUE (installation_id,artifact_digest),
  UNIQUE (installation_id,decision_digest),
  FOREIGN KEY (installation_id,artifact_digest)
    REFERENCES diagnostic_artifacts(installation_id,artifact_digest)
);

CREATE TABLE diagnostic_material_states (
  erasure_decision_id uuid PRIMARY KEY REFERENCES diagnostic_material_erasure_decisions(erasure_decision_id),
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  environment_id uuid NOT NULL,
  artifact_digest text NOT NULL CHECK (artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('revoked_pending_deletion','deleted_verified')),
  state_revision bigint NOT NULL CHECK (state_revision >= 0),
  last_transition_id uuid NOT NULL REFERENCES diagnostic_transitions(transition_id),
  updated_at timestamptz NOT NULL,
  UNIQUE (installation_id,artifact_digest),
  FOREIGN KEY (installation_id,artifact_digest)
    REFERENCES diagnostic_artifacts(installation_id,artifact_digest)
);

CREATE TABLE diagnostic_material_deletion_attempts (
  deletion_attempt_id uuid PRIMARY KEY,
  erasure_decision_id uuid NOT NULL REFERENCES diagnostic_material_erasure_decisions(erasure_decision_id),
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  artifact_digest text NOT NULL CHECK (artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  outcome text NOT NULL CHECK (outcome IN ('deleted','already_absent','failed')),
  verification_status text NOT NULL CHECK (verification_status IN ('verified_absent','unverified')),
  error_code text,
  attempt_document jsonb NOT NULL CHECK (jsonb_typeof(attempt_document) = 'object'),
  attempt_digest text NOT NULL CHECK (attempt_digest ~ '^sha256:[0-9a-f]{64}$'),
  attempted_by text NOT NULL,
  attempted_at timestamptz NOT NULL,
  UNIQUE (installation_id,attempt_digest)
);

CREATE TABLE diagnostic_artifact_erasure_tombstones (
  erasure_decision_id uuid PRIMARY KEY REFERENCES diagnostic_material_erasure_decisions(erasure_decision_id),
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  environment_id uuid NOT NULL,
  artifact_digest text NOT NULL CHECK (artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  deletion_attempt_id uuid NOT NULL UNIQUE REFERENCES diagnostic_material_deletion_attempts(deletion_attempt_id),
  tombstone_document jsonb NOT NULL CHECK (jsonb_typeof(tombstone_document) = 'object'),
  tombstone_digest text NOT NULL CHECK (tombstone_digest ~ '^sha256:[0-9a-f]{64}$'),
  completed_at timestamptz NOT NULL,
  UNIQUE (installation_id,artifact_digest),
  UNIQUE (installation_id,tombstone_digest)
);

CREATE TABLE diagnostic_package_material_availability_events (
  availability_event_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  environment_id uuid NOT NULL,
  evidence_package_id uuid NOT NULL REFERENCES diagnostic_evidence_packages(evidence_package_id),
  erasure_decision_id uuid NOT NULL REFERENCES diagnostic_material_erasure_decisions(erasure_decision_id),
  from_revision bigint NOT NULL CHECK (from_revision >= 0),
  to_revision bigint NOT NULL CHECK (to_revision = from_revision + 1),
  from_status text NOT NULL CHECK (from_status IN (
    'complete','partially_unavailable','material_unavailable'
  )),
  to_status text NOT NULL CHECK (to_status IN ('partially_unavailable','material_unavailable')),
  event_document jsonb NOT NULL CHECK (jsonb_typeof(event_document) = 'object'),
  event_digest text NOT NULL CHECK (event_digest ~ '^sha256:[0-9a-f]{64}$'),
  occurred_at timestamptz NOT NULL,
  UNIQUE (evidence_package_id,erasure_decision_id),
  UNIQUE (installation_id,event_digest)
);

CREATE TABLE diagnostic_package_material_availability_states (
  evidence_package_id uuid PRIMARY KEY REFERENCES diagnostic_evidence_packages(evidence_package_id),
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  environment_id uuid NOT NULL,
  material_status text NOT NULL CHECK (material_status IN (
    'partially_unavailable','material_unavailable'
  )),
  execution_eligible boolean NOT NULL CHECK (execution_eligible = false),
  integrity_status text NOT NULL CHECK (integrity_status = 'verified_governed_erasure'),
  cause text NOT NULL,
  projection_document jsonb NOT NULL CHECK (jsonb_typeof(projection_document) = 'object'),
  projection_digest text NOT NULL CHECK (projection_digest ~ '^sha256:[0-9a-f]{64}$'),
  state_revision bigint NOT NULL CHECK (state_revision >= 1),
  last_event_id uuid NOT NULL REFERENCES diagnostic_package_material_availability_events(availability_event_id),
  current_as_of timestamptz NOT NULL,
  UNIQUE (installation_id,projection_digest)
);

CREATE TABLE diagnostic_assignment_material_invalidations (
  invalidation_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  environment_id uuid NOT NULL,
  assignment_id uuid NOT NULL REFERENCES diagnostic_assignments(assignment_id),
  evidence_package_id uuid NOT NULL REFERENCES diagnostic_evidence_packages(evidence_package_id),
  erasure_decision_id uuid NOT NULL REFERENCES diagnostic_material_erasure_decisions(erasure_decision_id),
  action text NOT NULL CHECK (action IN (
    'expired_unclaimed','cancelled_claimed','already_terminal'
  )),
  workspace_destruction_required boolean NOT NULL,
  broker_revocation_required boolean NOT NULL,
  invalidation_document jsonb NOT NULL CHECK (jsonb_typeof(invalidation_document) = 'object'),
  invalidation_digest text NOT NULL CHECK (invalidation_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  UNIQUE (assignment_id,erasure_decision_id),
  UNIQUE (installation_id,invalidation_digest)
);

CREATE INDEX diagnostic_material_hold_artifact_idx
  ON diagnostic_material_retention_holds (installation_id,artifact_digest,hold_class,expires_at);
CREATE INDEX diagnostic_material_decision_artifact_idx
  ON diagnostic_material_erasure_decisions (installation_id,artifact_digest);
CREATE INDEX diagnostic_material_deletion_attempt_idx
  ON diagnostic_material_deletion_attempts (erasure_decision_id,attempted_at,deletion_attempt_id);
CREATE INDEX diagnostic_package_material_availability_idx
  ON diagnostic_package_material_availability_states
    (installation_id,environment_id,material_status,current_as_of,evidence_package_id);

CREATE TRIGGER diagnostic_material_retention_holds_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_material_retention_holds
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_material_retention_hold_releases_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_material_retention_hold_releases
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_material_erasure_decisions_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_material_erasure_decisions
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_material_deletion_attempts_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_material_deletion_attempts
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_artifact_erasure_tombstones_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_artifact_erasure_tombstones
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_package_material_availability_events_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_package_material_availability_events
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_assignment_material_invalidations_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_assignment_material_invalidations
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();

CREATE OR REPLACE FUNCTION diagnostic_validate_material_state_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.erasure_decision_id <> NEW.erasure_decision_id
     OR OLD.installation_id <> NEW.installation_id
     OR OLD.environment_id <> NEW.environment_id
     OR OLD.artifact_digest <> NEW.artifact_digest
     OR NEW.state_revision <> OLD.state_revision + 1
     OR OLD.state <> 'revoked_pending_deletion'
     OR NEW.state <> 'deleted_verified' THEN
    RAISE EXCEPTION 'diagnostic material state transition is invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER diagnostic_material_states_guard
  BEFORE UPDATE ON diagnostic_material_states
  FOR EACH ROW EXECUTE FUNCTION diagnostic_validate_material_state_update();
CREATE TRIGGER diagnostic_material_states_no_delete
  BEFORE DELETE ON diagnostic_material_states
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();

CREATE OR REPLACE FUNCTION diagnostic_validate_package_material_availability_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.evidence_package_id <> NEW.evidence_package_id
     OR OLD.installation_id <> NEW.installation_id
     OR OLD.environment_id <> NEW.environment_id
     OR NEW.state_revision <> OLD.state_revision + 1
     OR NEW.execution_eligible <> false
     OR NEW.integrity_status <> 'verified_governed_erasure'
     OR (OLD.material_status = 'material_unavailable' AND NEW.material_status <> 'material_unavailable') THEN
    RAISE EXCEPTION 'diagnostic package material availability transition is invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER diagnostic_package_material_availability_states_guard
  BEFORE UPDATE ON diagnostic_package_material_availability_states
  FOR EACH ROW EXECUTE FUNCTION diagnostic_validate_package_material_availability_update();
CREATE TRIGGER diagnostic_package_material_availability_states_no_delete
  BEFORE DELETE ON diagnostic_package_material_availability_states
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
