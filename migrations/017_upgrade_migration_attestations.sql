ALTER TABLE kernel_upgrade_migration_checkpoints
  ADD COLUMN attestation_signature text NOT NULL
  DEFAULT 'hmac-sha256:0000000000000000000000000000000000000000000000000000000000000000'
  CHECK (attestation_signature ~ '^hmac-sha256:[0-9a-f]{64}$');

ALTER TABLE kernel_upgrade_migration_verifications
  ADD COLUMN attestation_signature text NOT NULL
  DEFAULT 'hmac-sha256:0000000000000000000000000000000000000000000000000000000000000000'
  CHECK (attestation_signature ~ '^hmac-sha256:[0-9a-f]{64}$');

ALTER TABLE kernel_upgrade_migration_checkpoints ALTER COLUMN attestation_signature DROP DEFAULT;
ALTER TABLE kernel_upgrade_migration_verifications ALTER COLUMN attestation_signature DROP DEFAULT;
