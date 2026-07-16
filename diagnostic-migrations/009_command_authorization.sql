ALTER TABLE diagnostic_commands
  ADD COLUMN authorization_context jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(authorization_context) = 'object');

ALTER TABLE diagnostic_transitions
  ADD COLUMN authorization_context jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(authorization_context) = 'object');
