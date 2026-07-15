CREATE TABLE kernel_coordinator_bindings (
  binding_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  coordinator_id text NOT NULL,
  coordinator_endpoint text NOT NULL,
  coordinator_public_key text NOT NULL,
  customer_id text NOT NULL,
  disclosure_scope jsonb NOT NULL CHECK (jsonb_typeof(disclosure_scope) = 'array'),
  promotion_scope jsonb NOT NULL CHECK (jsonb_typeof(promotion_scope) = 'object'),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_by_actor_id text NOT NULL,
  UNIQUE (installation_id, environment_id, binding_id),
  FOREIGN KEY (installation_id, environment_id)
    REFERENCES kernel_environments(installation_id, environment_id)
);

CREATE TABLE kernel_coordinator_binding_states (
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  binding_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('active', 'revoked')),
  revision bigint NOT NULL CHECK (revision >= 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (installation_id, environment_id, binding_id),
  FOREIGN KEY (installation_id, environment_id, binding_id)
    REFERENCES kernel_coordinator_bindings(installation_id, environment_id, binding_id)
);

CREATE TABLE kernel_environment_descriptors (
  descriptor_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  binding_id uuid NOT NULL,
  signed_descriptor jsonb NOT NULL CHECK (jsonb_typeof(signed_descriptor) = 'object'),
  descriptor_digest text NOT NULL CHECK (descriptor_digest ~ '^sha256:[0-9a-f]{64}$'),
  registered_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, descriptor_digest),
  FOREIGN KEY (installation_id, environment_id, binding_id)
    REFERENCES kernel_coordinator_bindings(installation_id, environment_id, binding_id)
);

CREATE TABLE kernel_received_promotion_proposals (
  proposal_id text NOT NULL,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  binding_id uuid NOT NULL,
  package_identity text NOT NULL,
  signed_proposal jsonb NOT NULL CHECK (jsonb_typeof(signed_proposal) = 'object'),
  proposal_digest text NOT NULL CHECK (proposal_digest ~ '^sha256:[0-9a-f]{64}$'),
  received_at timestamptz NOT NULL,
  PRIMARY KEY (installation_id, environment_id, proposal_id),
  UNIQUE (installation_id, environment_id, proposal_digest),
  FOREIGN KEY (installation_id, environment_id, binding_id)
    REFERENCES kernel_coordinator_bindings(installation_id, environment_id, binding_id)
);

CREATE TABLE kernel_promotion_resolutions (
  resolution_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  proposal_id text NOT NULL,
  package_identity text NOT NULL,
  local_deployment_plan jsonb NOT NULL CHECK (jsonb_typeof(local_deployment_plan) = 'object'),
  plan_digest text NOT NULL CHECK (plan_digest ~ '^sha256:[0-9a-f]{64}$'),
  configuration_fingerprint text NOT NULL CHECK (configuration_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  resolved_by_actor_id text NOT NULL,
  resolved_at timestamptz NOT NULL,
  UNIQUE (installation_id, environment_id, proposal_id),
  FOREIGN KEY (installation_id, environment_id, proposal_id)
    REFERENCES kernel_received_promotion_proposals(installation_id, environment_id, proposal_id)
);

CREATE TABLE kernel_promotion_receipts (
  receipt_id text NOT NULL,
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  proposal_id text NOT NULL,
  package_identity text NOT NULL,
  receipt_type text NOT NULL,
  authoritative_reference jsonb NOT NULL CHECK (jsonb_typeof(authoritative_reference) = 'object'),
  signed_receipt jsonb NOT NULL CHECK (jsonb_typeof(signed_receipt) = 'object'),
  receipt_digest text NOT NULL CHECK (receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_by_actor_id text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (installation_id, environment_id, receipt_id),
  UNIQUE (installation_id, environment_id, receipt_digest)
);

CREATE TABLE kernel_promotion_receipt_delivery_states (
  installation_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  receipt_id text NOT NULL,
  delivery_state text NOT NULL CHECK (delivery_state IN ('pending', 'delivered')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  PRIMARY KEY (installation_id, environment_id, receipt_id),
  FOREIGN KEY (installation_id, environment_id, receipt_id)
    REFERENCES kernel_promotion_receipts(installation_id, environment_id, receipt_id)
);

CREATE INDEX kernel_received_promotion_proposals_idx
  ON kernel_received_promotion_proposals(installation_id, environment_id, received_at);
CREATE INDEX kernel_promotion_receipts_proposal_idx
  ON kernel_promotion_receipts(installation_id, environment_id, proposal_id, created_at);

CREATE TRIGGER kernel_coordinator_bindings_immutable BEFORE UPDATE OR DELETE ON kernel_coordinator_bindings
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_environment_descriptors_immutable BEFORE UPDATE OR DELETE ON kernel_environment_descriptors
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_received_promotion_proposals_immutable BEFORE UPDATE OR DELETE ON kernel_received_promotion_proposals
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_promotion_resolutions_immutable BEFORE UPDATE OR DELETE ON kernel_promotion_resolutions
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
CREATE TRIGGER kernel_promotion_receipts_immutable BEFORE UPDATE OR DELETE ON kernel_promotion_receipts
  FOR EACH ROW EXECUTE FUNCTION kernel_reject_immutable_mutation();
