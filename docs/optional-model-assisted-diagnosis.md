# Optional Model-Assisted Diagnosis

Alphonse V0.2 can attach a customer-controlled Diagnostic Worker to a demonstrated failure. This layer is optional. The deterministic Debug Loop remains complete and usable without a model.

## Boundary

The Diagnostic Worker has its own Agent Principal, short-lived Agent Passport, and confirmed `diagnostic_analysis` Work Intent. Its scope binds one exact Diagnostic Case, Agent Revision, and redacted Reproduction Bundle. It must not reuse a registered Repair Worker identity.

The worker can retrieve only the confirmed Failure Specification, trace references, exact Agent Revision, redacted Reproduction Bundle, and request instruction assigned to it. Alphonse never supplies or stores model-provider credentials.

The worker has no endpoint or authority to:

- declare or alter failure truth;
- mutate evidence or reproduction material;
- commission or submit repair work;
- create a Verification Receipt;
- authorize or apply a Promotion;
- change the target system.

Using the same model as the affected workflow does not make a diagnosis independent verification. Alphonse records the proposal as advisory regardless of model choice.

## Proposal Contract

Every proposal separates source-backed facts, inferences, hypotheses and confidence, uncertainties, recommended investigation, and artifact references. Its immutable identity binds:

- exact request, case, and Diagnostic Worker registration;
- model provider, model, and version attribution;
- worker runtime name and version;
- instruction digest;
- exact input artifact digests.

A changed model or changed instruction creates a distinct proposal or request. Existing records are never updated.

## Review And Failure

A Builder can mark a proposal `accepted` or `rejected` for usefulness, or leave it `unreviewed`. Review does not alter demonstrated failure truth, verification eligibility, promotion eligibility, or authority.

Invalid output is rejected before persistence. Worker failure is an immutable advisory event. Expiry is projected from the request deadline. Low-quality output may remain ignored. All three outcomes leave deterministic repair, verification, and promotion available.

## Proof

Run:

```powershell
npm run test:v0.2-ticket-12
```

The isolated proof starts from the real deterministic V0.2 failure and repair fixture. It proves exact-source retrieval, distinct identity, wrong-worker denial, immutable model/instruction variants, accept/reject/ignore review, secret rejection, timeout/failure fallback, unchanged Diagnostic Case state, zero Kernel Runs, and zero AWS activity.

This feature does not introduce anomaly detection, broad scoring, agent certification, or automatic repair.
