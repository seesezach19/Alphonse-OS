---
status: accepted
---

# Separate diagnostics from authority

High-volume and potentially sensitive agent traces live in a retention-controlled Diagnostic Plane, not the Kernel ledger or business Data Plane. Kernel may retain exact diagnostic references and digests when they support evidence or investigation, but diagnostics remain untrusted observations until admitted through an explicit evidence transition.
