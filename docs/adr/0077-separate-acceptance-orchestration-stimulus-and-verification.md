# Separate Acceptance Orchestration, Stimulus, And Verification

The duplicate-delivery acceptance proof uses separate one-shot technical Principals for environment setup,
scenario stimulus, and result verification. The Test Orchestrator registers inactive governed material and grants,
waits for readiness and Workflow Attestation Binding, requests activation, records the ordered Sealed Deployment
Manifest only after the receiving services durably apply grant snapshots and return signed application receipts,
relinquishes credentials, and exits before delivery. Scenario Stimulus can send only
the two bounded ingress requests and is destroyed before the Acceptance Verifier starts. The verifier has read-only
access to immutable proof artifacts and hidden assertions but no observation, packaging, assignment, dispatch,
diagnosis, or repair authority.

Separate containers, tokens, networks, and mounts enforce the split. A trusted one-shot bootstrap launcher controls
Docker Compose and secret installation, then exits. A later narrow runtime supervisor may sequence the scenario but
has no Docker socket, secret-store authority, host mounts, or evidence-authoring credential. Acceptance asserts every observation was authenticated under the expected
observer-specific grant and HMAC key, controllers were excluded from key custody, deterministic services authored
packages and assignments, controller roles produced none, no package artifact originated from a controller-owned
path, and no worker received verifier or answer-key material. HMAC does not prove exclusive observer authorship.

This is host-enforced rather than cryptographically attested, but it removes the credible path for one broad
controller to manufacture the diagnosis it later judges. These controls prove configured exclusion only under a
trusted-host and trusted-Docker-daemon threat model; they do not prove exclusion against a hostile host or bootstrap
launcher.
