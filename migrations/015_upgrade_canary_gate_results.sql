ALTER TABLE kernel_upgrade_canary_attempts
  DROP CONSTRAINT kernel_upgrade_canary_attempts_gate_results_check;

ALTER TABLE kernel_upgrade_canary_attempts
  ADD CONSTRAINT kernel_upgrade_canary_attempts_gate_results_check
  CHECK (jsonb_typeof(gate_results) = 'array');
