ALTER TABLE kernel_environments
  ADD COLUMN environment_class text NOT NULL DEFAULT 'development'
  CHECK (environment_class IN ('development', 'staging', 'production'));

CREATE TABLE registry_publications (
  registry_id text NOT NULL,
  package_id text NOT NULL,
  semantic_version text NOT NULL,
  package_artifact_digest text NOT NULL CHECK (package_artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  manifest_digest text NOT NULL CHECK (manifest_digest ~ '^sha256:[0-9a-f]{64}$'),
  release_digest text NOT NULL CHECK (release_digest ~ '^sha256:[0-9a-f]{64}$'),
  release_record jsonb NOT NULL CHECK (jsonb_typeof(release_record) = 'object'),
  custody_receipts jsonb NOT NULL CHECK (jsonb_typeof(custody_receipts) = 'array'),
  published_at timestamptz NOT NULL,
  PRIMARY KEY (registry_id, package_id, semantic_version),
  UNIQUE (registry_id, package_id, manifest_digest, package_artifact_digest)
);

CREATE TABLE registry_transparency_entries (
  registry_id text NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  entry_type text NOT NULL CHECK (entry_type IN ('publication', 'advisory')),
  entry_digest text NOT NULL CHECK (entry_digest ~ '^sha256:[0-9a-f]{64}$'),
  root_hash text NOT NULL CHECK (root_hash ~ '^sha256:[0-9a-f]{64}$'),
  entry jsonb NOT NULL CHECK (jsonb_typeof(entry) = 'object'),
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY (registry_id, sequence)
);

CREATE TABLE registry_advisories (
  registry_id text NOT NULL,
  advisory_id text NOT NULL,
  package_id text NOT NULL,
  manifest_digest text NOT NULL CHECK (manifest_digest ~ '^sha256:[0-9a-f]{64}$'),
  package_artifact_digest text NOT NULL CHECK (package_artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  advisory jsonb NOT NULL CHECK (jsonb_typeof(advisory) = 'object'),
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY (registry_id, advisory_id)
);

CREATE TABLE kernel_trust_policies (
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  policy_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  environment_class text NOT NULL,
  policy_document jsonb NOT NULL CHECK (jsonb_typeof(policy_document) = 'object'),
  policy_digest text NOT NULL CHECK (policy_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_by_actor_id text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (installation_id, environment_id, policy_id, version),
  UNIQUE (installation_id, environment_id, policy_digest),
  FOREIGN KEY (installation_id, environment_id)
    REFERENCES kernel_environments(installation_id, environment_id)
);

CREATE TABLE kernel_quarantined_packages (
  quarantine_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  package_id text NOT NULL,
  semantic_version text NOT NULL,
  package_artifact_digest text NOT NULL CHECK (package_artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  package_identity text NOT NULL,
  bundle jsonb NOT NULL CHECK (jsonb_typeof(bundle) = 'object'),
  bundle_digest text NOT NULL CHECK (bundle_digest ~ '^sha256:[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state = 'quarantined'),
  quarantined_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, quarantine_id),
  UNIQUE (installation_id, environment_id, package_identity),
  FOREIGN KEY (installation_id, environment_id)
    REFERENCES kernel_environments(installation_id, environment_id)
);

CREATE TABLE kernel_package_import_receipts (
  import_receipt_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  policy_id text NOT NULL,
  policy_version integer NOT NULL,
  importer_actor_id text NOT NULL,
  work_intent_id uuid NOT NULL,
  transport text NOT NULL CHECK (transport IN ('registry', 'mirror', 'offline_bundle')),
  package_identity text NOT NULL,
  bundle_digest text NOT NULL CHECK (bundle_digest ~ '^sha256:[0-9a-f]{64}$'),
  evidence_digest text NOT NULL CHECK (evidence_digest ~ '^sha256:[0-9a-f]{64}$'),
  advisory_snapshot_digest text NOT NULL CHECK (advisory_snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
  verification_digest text NOT NULL CHECK (verification_digest ~ '^sha256:[0-9a-f]{64}$'),
  admissible boolean NOT NULL,
  verification_result jsonb NOT NULL CHECK (jsonb_typeof(verification_result) = 'object'),
  quarantine_id uuid,
  imported_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, import_receipt_id),
  FOREIGN KEY (installation_id, environment_id, policy_id, policy_version)
    REFERENCES kernel_trust_policies(installation_id, environment_id, policy_id, version),
  FOREIGN KEY (installation_id, environment_id, work_intent_id)
    REFERENCES kernel_work_intents(installation_id, environment_id, work_intent_id),
  FOREIGN KEY (installation_id, environment_id, quarantine_id)
    REFERENCES kernel_quarantined_packages(installation_id, environment_id, quarantine_id)
);

CREATE INDEX registry_publications_discovery_idx
  ON registry_publications (registry_id, package_id, semantic_version);
CREATE INDEX registry_advisories_package_idx
  ON registry_advisories (registry_id, package_id, manifest_digest, package_artifact_digest);
CREATE INDEX kernel_quarantined_packages_identity_idx
  ON kernel_quarantined_packages (installation_id, environment_id, package_id, semantic_version);
CREATE INDEX kernel_package_import_receipts_package_idx
  ON kernel_package_import_receipts (installation_id, environment_id, package_identity, imported_at);

CREATE TRIGGER registry_publications_immutable BEFORE UPDATE OR DELETE ON registry_publications
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER registry_transparency_entries_immutable BEFORE UPDATE OR DELETE ON registry_transparency_entries
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER registry_advisories_immutable BEFORE UPDATE OR DELETE ON registry_advisories
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_trust_policies_immutable BEFORE UPDATE OR DELETE ON kernel_trust_policies
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_quarantined_packages_immutable BEFORE UPDATE OR DELETE ON kernel_quarantined_packages
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_package_import_receipts_immutable BEFORE UPDATE OR DELETE ON kernel_package_import_receipts
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();

ALTER TABLE registry_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE registry_transparency_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE registry_advisories ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  role_name text;
  registry_name text;
  table_name text;
BEGIN
  FOR role_name, registry_name IN VALUES
    ('alphonse_registry_primary', 'registry:primary'),
    ('alphonse_registry_mirror', 'registry:mirror')
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', role_name);
      FOREACH table_name IN ARRAY ARRAY['registry_publications', 'registry_transparency_entries', 'registry_advisories']
      LOOP
        EXECUTE format('GRANT SELECT, INSERT ON %I TO %I', table_name, role_name);
        EXECUTE format('CREATE POLICY %I ON %I TO %I USING (registry_id = %L) WITH CHECK (registry_id = %L)',
          role_name || '_' || table_name, table_name, role_name, registry_name, registry_name);
      END LOOP;
    END IF;
  END LOOP;
END;
$$;
