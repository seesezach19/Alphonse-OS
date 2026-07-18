# Diagnostic Dispatch Authority And Atomic Claim

Ticket 15 turns one model-free unclaimed Diagnostic Assignment into one exact, claimed-but-not-launched Worker Run.
Assignment creation remains authority-free. Dispatch is a later, separately authenticated Kernel decision, and claim is
a Diagnostic Plane transaction.

## Exact Candidate And Kernel Decision

The dispatcher proposes one closed candidate binding the Assignment and Evidence Package digests, Assignment Policy
activation, worker Principal and active Passport configuration, Worker Run identifier, image digest, runner audience,
isolation, mounts, network, model, broker policy, resources, data classification, egress, and expiry.

Kernel checks the candidate against current Diagnostic Plane eligibility under the installation material mutation
fence and against the immutable Passport in Kernel storage. It rejects stale Assignment state, unavailable material,
digest drift, Passport ambiguity, runtime or audience drift, broader disclosure, ambient egress, and resource
expansion. A successful decision creates an immutable short-lived authorization with an unguessable nonce. The signed
document grants only one exact Assignment claim and Worker Run binding; it does not grant repair or external business
effects and does not create a model credential, broker token, container, provider request, or diagnosis.

Kernel stores Diagnostic Plane identifiers, digests, and the signed decision. It does not store evidence bytes. Its
read model says only that issuance occurred. Consumption remains Diagnostic Plane truth and is deliberately not
mirrored as if Kernel could atomically observe a different database.

## Diagnostic Plane Consumption

The Diagnostic Plane independently verifies the canonical signed document, expiry, dispatcher and runner audiences,
decision artifact digest, current Assignment and package digests, work requirements, and current material
availability. Under the same material mutation fence it atomically:

1. records one immutable authorization consumption;
2. advances the Assignment from `unclaimed` to `claimed`;
3. creates the exact immutable Worker Run; and
4. projects its initial state as `claimed_not_launched`.

Unique constraints cover authorization, nonce, Assignment, and Worker Run identity. The transaction and Assignment
state compare-and-swap permit one winner when multiple otherwise-valid authorizations race. Reusing the accepted
command is idempotent; a new command using stale or consumed authority cannot create another run.

The state machine has no transition back to `unclaimed`. A retry requires a new linked immutable Assignment and a new
Kernel decision. Launch, broker-token minting, model access, result validation, and teardown are later checkpoints.

## Assurance Boundary

The reference implementation uses HMAC-SHA-256 between Kernel and the Diagnostic Plane inside the trusted customer
installation boundary. This authenticates the decision between those services; it is not a hostile-host or
independent third-party signature claim. The decision artifact digest binds the two migrations, validation contracts,
authority service, claim service, material authority, Passport implementation, and server wiring used for the check.

Run the fresh-volume adversarial proof with:

```powershell
npm run test:canonical-proof:ticket-15
```
