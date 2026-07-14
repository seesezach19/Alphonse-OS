DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'alphonse_registry_primary') THEN
    CREATE ROLE alphonse_registry_primary LOGIN PASSWORD 'local-registry-primary-only';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'alphonse_registry_mirror') THEN
    CREATE ROLE alphonse_registry_mirror LOGIN PASSWORD 'local-registry-mirror-only';
  END IF;
END;
$$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE alphonse_kernel TO alphonse_registry_primary, alphonse_registry_mirror;
GRANT USAGE ON SCHEMA public TO alphonse_registry_primary, alphonse_registry_mirror;
