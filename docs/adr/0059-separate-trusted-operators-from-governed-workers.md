# ADR 0059: Separate trusted operators from governed workers

## Decision

Alphonse supports two explicit runtime trust modes.

- A governed worker receives one Agent Passport and can invoke only its scoped worker protocol.
- A trusted operator receives an ordinary Agent Passport whose intent class is `trusted_operator` and whose
  `package_skill_configuration.operator_operations` lists exact Diagnostic operations.

Trusted operators authenticate with the `Operator` scheme. Every command must include an authorization channel,
instruction digest, and authorization time. Alphonse records the sponsoring human as requester and authorizer while
recording the agent as executor. A trusted operator never becomes the human Owner and cannot issue another Passport.

Owner and bootstrap credentials are separate. Bootstrap credentials exist for installation compatibility; normal
operations use the Owner credential. Missing worker assignments fail closed and must never fall back to either.

## Consequences

- A customer may deliberately run a full-machine trusted operator without corrupting actor attribution.
- Governed workers remain technically bounded when deployed without host, Docker, Owner, or bootstrap access.
- Chat authorization is evidence, not identity. It is bound by digest and channel to a pre-issued operator passport.
- Host administrators remain outside the application enforcement boundary.
