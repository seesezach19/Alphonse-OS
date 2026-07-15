DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'kernel_upgrade_migration_verifications'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) = 'UNIQUE (installation_id, environment_id, migration_run_id)';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE kernel_upgrade_migration_verifications DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

CREATE INDEX kernel_upgrade_migration_verification_run_idx
  ON kernel_upgrade_migration_verifications
  (installation_id, environment_id, migration_run_id, verified_at DESC);

UPDATE kernel_upgrade_migration_states state
SET state = 'checkpointed', revision = state.revision + 1, updated_at = now()
FROM kernel_upgrade_migration_verifications verification
WHERE verification.installation_id = state.installation_id
  AND verification.environment_id = state.environment_id
  AND verification.migration_run_id = state.migration_run_id
  AND verification.attestation_signature =
    'hmac-sha256:0000000000000000000000000000000000000000000000000000000000000000'
  AND state.state = 'verified';

UPDATE kernel_upgrade_plan_states state
SET state = 'migrating', revision = state.revision + 1,
  detail = jsonb_build_object('reason', 'migration_reattestation_required'), updated_at = now()
FROM kernel_upgrade_migration_runs run
JOIN kernel_upgrade_migration_verifications verification
  ON verification.installation_id = run.installation_id
  AND verification.environment_id = run.environment_id
  AND verification.migration_run_id = run.migration_run_id
WHERE run.installation_id = state.installation_id
  AND run.environment_id = state.environment_id
  AND run.upgrade_plan_id = state.upgrade_plan_id
  AND verification.attestation_signature =
    'hmac-sha256:0000000000000000000000000000000000000000000000000000000000000000'
  AND state.state IN ('verified', 'canary_paused', 'canary_passed');
