ALTER TABLE kernel_recovery_case_states DROP CONSTRAINT kernel_recovery_case_states_status_check;
ALTER TABLE kernel_recovery_case_states ADD CONSTRAINT kernel_recovery_case_states_status_check
  CHECK (status IN ('open', 'reconciling', 'resolved_applied', 'open_applied_accountability', 'open_not_applied'));
