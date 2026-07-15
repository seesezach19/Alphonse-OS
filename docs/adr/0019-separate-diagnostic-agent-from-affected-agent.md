---
status: superseded by ADR-0032
---

# Separate the Diagnostic Agent from the affected agent

Alphonse uses a separate replaceable Diagnostic Agent to correlate failures, reproduce behavior, and create and evaluate Repair Candidates. The affected customer agent must emit attributable observations and may submit self-diagnosis, but it cannot adjudicate its own behavior, certify a repair, approve authority, or promote changes.
