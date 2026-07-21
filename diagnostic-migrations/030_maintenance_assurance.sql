CREATE TABLE diagnostic_maintenance_assurance_exports (
  export_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES diagnostic_nodes(installation_id),
  case_id uuid NOT NULL REFERENCES diagnostic_cases(case_id),
  workflow_id text NOT NULL,
  assignment_id uuid NOT NULL REFERENCES diagnostic_assignments(assignment_id),
  worker_run_id uuid NOT NULL REFERENCES diagnostic_worker_runs(worker_run_id),
  diagnosis_id uuid NOT NULL REFERENCES diagnostic_worker_run_diagnoses(diagnosis_id),
  repair_candidate_id uuid NOT NULL REFERENCES diagnostic_repair_candidates(candidate_id),
  repair_delivery_id uuid NOT NULL REFERENCES diagnostic_repair_deliveries(delivery_id),
  verification_id uuid NOT NULL REFERENCES diagnostic_verification_receipts(verification_id),
  promotion_id uuid NOT NULL REFERENCES diagnostic_promotions(promotion_id),
  assurance_document jsonb NOT NULL CHECK (jsonb_typeof(assurance_document) = 'object'),
  assurance_digest text NOT NULL CHECK (assurance_digest ~ '^sha256:[0-9a-f]{64}$'),
  human_readable_markdown text NOT NULL,
  created_by_actor_type text NOT NULL,
  created_by_actor_id text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (installation_id, promotion_id, assurance_digest)
);

CREATE INDEX diagnostic_maintenance_assurance_case_idx
  ON diagnostic_maintenance_assurance_exports (installation_id, case_id, created_at, export_id);

CREATE TRIGGER diagnostic_maintenance_assurance_exports_immutable
  BEFORE UPDATE OR DELETE ON diagnostic_maintenance_assurance_exports
  FOR EACH ROW EXECUTE FUNCTION diagnostic_reject_immutable_mutation();
