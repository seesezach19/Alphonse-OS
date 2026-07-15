CREATE TABLE kernel_upgrade_activation_policies (
  upgrade_activation_policy_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  compatibility_report_id uuid NOT NULL,
  authority_equivalence_digest text NOT NULL CHECK (authority_equivalence_digest ~ '^sha256:[0-9a-f]{64}$'),
  rationale text NOT NULL CHECK (length(rationale) BETWEEN 1 AND 2000),
  approved_by_actor_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, upgrade_activation_policy_id),
  FOREIGN KEY (installation_id, environment_id, compatibility_report_id)
    REFERENCES kernel_upgrade_compatibility_reports(installation_id, environment_id, compatibility_report_id)
);

CREATE INDEX kernel_upgrade_activation_policy_report_idx
  ON kernel_upgrade_activation_policies (installation_id, environment_id, compatibility_report_id, expires_at DESC);

CREATE TRIGGER kernel_upgrade_activation_policies_immutable BEFORE UPDATE OR DELETE ON kernel_upgrade_activation_policies
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();

ALTER TABLE kernel_upgrade_plan_states DROP CONSTRAINT kernel_upgrade_plan_states_state_check;
ALTER TABLE kernel_upgrade_plan_states ADD CONSTRAINT kernel_upgrade_plan_states_state_check
  CHECK (state IN ('planned','migrating','verified','canary_paused','canary_passed',
    'active','rolled_back','repair_required','repair_verified','retired'));

ALTER TABLE kernel_upgrade_recovery_actions DROP CONSTRAINT kernel_upgrade_recovery_actions_action_type_check;
ALTER TABLE kernel_upgrade_recovery_actions ADD CONSTRAINT kernel_upgrade_recovery_actions_action_type_check
  CHECK (action_type IN ('deployment_rollback','forward_repair','compensation',
    'forward_repair_verified','compensation_verified'));

ALTER TABLE kernel_upgrade_recovery_actions
  ADD COLUMN attestation_signature text
  CHECK (attestation_signature IS NULL OR attestation_signature ~ '^hmac-sha256:[0-9a-f]{64}$');
