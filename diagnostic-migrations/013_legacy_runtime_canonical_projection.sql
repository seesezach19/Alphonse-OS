ALTER TABLE diagnostic_runtime_event_receipts
  ADD COLUMN canonical_observation_receipt_id uuid
    REFERENCES diagnostic_observation_receipts(receipt_id),
  ADD COLUMN compatibility_translator_id text,
  ADD COLUMN compatibility_translator_version text,
  ADD COLUMN compatibility_translator_artifact_digest text,
  ADD COLUMN compatibility_translator_rules_digest text;

CREATE UNIQUE INDEX diagnostic_runtime_event_canonical_receipt_idx
  ON diagnostic_runtime_event_receipts (installation_id,canonical_observation_receipt_id)
  WHERE canonical_observation_receipt_id IS NOT NULL;
