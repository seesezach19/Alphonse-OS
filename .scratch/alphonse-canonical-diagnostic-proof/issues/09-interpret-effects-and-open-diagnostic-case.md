# 09 - Interpret committed effects and open the diagnostic case

**What to build:** Activate the exact integration and workflow behavior semantics, convert CRM reports into normalized
diagnostic effects, evaluate the bounded duplicate invariant, and open one attributable Diagnostic Case without
leaking the expected diagnosis.

**Blocked by:** 08 - Project one operation across all observer streams.

**Status:** ready-for-agent

- [ ] Activate one exact Integration Behavior Contract describing only key location and exact-string comparison,
      matching-key behavior, designated ledger feed, commit-record semantics, consistency, and reconciliation.
- [ ] Activate one exact Behavior Contract declaring at most one committed CRM-create effect per logical operation.
- [ ] Export and activate one bounded `count_by_correlation` evaluator through the Operational Package.
- [ ] Enforce closed contract schemas, neutral identifiers, and leakage checks covering notes, metadata, labels,
      filenames, descriptions, fixture identities, implementation hints, and expected diagnosis.
- [ ] Produce an immutable Diagnostic Effect Projection that interprets both ledger claims as `committed` under the
      exact Integration Behavior Contract and records their permitted commitment basis.
- [ ] Prevent the evaluator from reading raw observations, HTTP responses, artifacts, snapshots, or uninterpreted
      effect-feed claims.
- [ ] Create a `violated` Behavior Evaluation Record showing two committed effects against threshold one.
- [ ] Deterministically create one Diagnostic Trigger and case without claiming root cause, repair authority, or
      Kernel Effect authority.
