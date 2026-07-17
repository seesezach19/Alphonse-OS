# Authorize Worker Dispatch Separately From Assignment Creation

The Diagnostic Plane Assignment Service may create one immutable unclaimed assignment under an activated diagnostic
policy. The assignment describes available work and binds evidence, instructions, output, worker requirements,
runtime policy, resources, and expiry, but grants no execution, model disclosure, credential, or resource authority.

Before claim, a dispatcher proposes an exact worker, Passport, Worker Run, image, isolation, model, broker, resource,
classification, egress, and expiry candidate. Kernel verifies assignment state and digests, worker and Passport
scope, zero external-effect authority, runner controls, allowed policies, data residency, resource ceilings, evidence
availability, and authorization conflicts. It then issues a short-lived single-use Diagnostic Dispatch Authorization
bound to dispatcher and runner audience and stores only Diagnostic Plane references and digests.

The dispatcher presents that authorization to the Diagnostic Plane, which atomically changes unclaimed to claimed
and creates the Worker Run. Only that claimant may obtain a run-scoped broker token, and authorization consumption
cannot launch another run. Atomic claim resolves competing stale authorizations. Failed or expired runs require a
new linked assignment and authority decision. The assignment-creation acceptance proof asserts no dispatch request,
authorization, claim, Worker Run, broker token, or model request exists.
