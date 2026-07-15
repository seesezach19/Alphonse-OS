CREATE TABLE diagnostic_diagnosis_worker_registrations (
  registration_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  passport_id uuid NOT NULL,
  agent_principal_id uuid NOT NULL,
  work_intent_id uuid NOT NULL,
  work_intent_digest text NOT NULL CHECK (work_intent_digest ~ '^sha256:[0-9a-f]{64}$'),
  work_intent_scope jsonb NOT NULL CHECK (jsonb_typeof(work_intent_scope) = 'object'),
  work_intent_constraints jsonb NOT NULL CHECK (jsonb_typeof(work_intent_constraints) = 'object'),
  passport_expires_at timestamptz NOT NULL,
  protocol_version text NOT NULL CHECK (protocol_version = '0.2.0'),
  runtime_attribution jsonb NOT NULL CHECK (jsonb_typeof(runtime_attribution) = 'object'),
  registration_digest text NOT NULL CHECK (registration_digest ~ '^sha256:[0-9a-f]{64}$'),
  registered_at timestamptz NOT NULL,
  UNIQUE (installation_id, passport_id, work_intent_id)
);

CREATE TABLE diagnostic_diagnosis_requests (
  request_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  case_id uuid NOT NULL REFERENCES diagnostic_cases(case_id),
  worker_registration_id uuid NOT NULL REFERENCES diagnostic_diagnosis_worker_registrations(registration_id),
  trace_id uuid NOT NULL REFERENCES diagnostic_external_activity_traces(trace_id),
  failure_specification_id uuid NOT NULL REFERENCES diagnostic_failure_specifications(failure_specification_id),
  failure_specification_digest text NOT NULL CHECK (failure_specification_digest ~ '^sha256:[0-9a-f]{64}$'),
  revision_id uuid NOT NULL REFERENCES diagnostic_agent_revisions(revision_id),
  revision_artifact_digest text NOT NULL,
  reproduction_bundle_id uuid NOT NULL REFERENCES diagnostic_reproduction_bundles(bundle_id),
  reproduction_bundle_artifact_digest text NOT NULL,
  instruction text NOT NULL CHECK (length(instruction) BETWEEN 1 AND 8000),
  instruction_digest text NOT NULL CHECK (instruction_digest ~ '^sha256:[0-9a-f]{64}$'),
  request_digest text NOT NULL CHECK (request_digest ~ '^sha256:[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  created_by_actor_type text NOT NULL,
  created_by_actor_id text NOT NULL,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (installation_id, revision_artifact_digest)
    REFERENCES diagnostic_artifacts(installation_id, artifact_digest),
  FOREIGN KEY (installation_id, reproduction_bundle_artifact_digest)
    REFERENCES diagnostic_artifacts(installation_id, artifact_digest),
  UNIQUE (installation_id, request_digest)
);

CREATE TABLE diagnostic_diagnosis_request_events (
  event_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  request_id uuid NOT NULL REFERENCES diagnostic_diagnosis_requests(request_id),
  event_index bigint NOT NULL CHECK (event_index >= 1),
  event_type text NOT NULL CHECK (event_type IN ('available','failed')),
  detail jsonb NOT NULL CHECK (jsonb_typeof(detail) = 'object'),
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  UNIQUE (installation_id, request_id, event_index)
);

CREATE TABLE diagnostic_diagnosis_proposals (
  proposal_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  request_id uuid NOT NULL REFERENCES diagnostic_diagnosis_requests(request_id),
  case_id uuid NOT NULL REFERENCES diagnostic_cases(case_id),
  worker_registration_id uuid NOT NULL REFERENCES diagnostic_diagnosis_worker_registrations(registration_id),
  proposal_digest text NOT NULL CHECK (proposal_digest ~ '^sha256:[0-9a-f]{64}$'),
  diagnosis jsonb NOT NULL CHECK (jsonb_typeof(diagnosis) = 'object'),
  model_provenance jsonb NOT NULL CHECK (jsonb_typeof(model_provenance) = 'object'),
  submitted_by_agent_principal_id uuid NOT NULL,
  submitted_at timestamptz NOT NULL,
  UNIQUE (installation_id, request_id, proposal_digest)
);

CREATE TABLE diagnostic_diagnosis_proposal_events (
  event_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  proposal_id uuid NOT NULL REFERENCES diagnostic_diagnosis_proposals(proposal_id),
  event_index bigint NOT NULL CHECK (event_index >= 1),
  event_type text NOT NULL CHECK (event_type IN ('proposed','accepted','rejected')),
  detail jsonb NOT NULL CHECK (jsonb_typeof(detail) = 'object'),
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  UNIQUE (installation_id, proposal_id, event_index)
);

CREATE INDEX diagnostic_diagnosis_requests_case_idx
  ON diagnostic_diagnosis_requests (installation_id, case_id, created_at, request_id);
CREATE INDEX diagnostic_diagnosis_proposals_case_idx
  ON diagnostic_diagnosis_proposals (installation_id, case_id, submitted_at, proposal_id);
CREATE UNIQUE INDEX diagnostic_diagnosis_proposal_single_review_idx
  ON diagnostic_diagnosis_proposal_events (installation_id, proposal_id)
  WHERE event_type IN ('accepted','rejected');

CREATE TRIGGER diagnostic_diagnosis_worker_registrations_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_diagnosis_worker_registrations
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_diagnosis_requests_immutable BEFORE UPDATE OR DELETE ON diagnostic_diagnosis_requests
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_diagnosis_request_events_immutable BEFORE UPDATE OR DELETE ON diagnostic_diagnosis_request_events
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_diagnosis_proposals_immutable BEFORE UPDATE OR DELETE ON diagnostic_diagnosis_proposals
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
CREATE TRIGGER diagnostic_diagnosis_proposal_events_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_diagnosis_proposal_events
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
