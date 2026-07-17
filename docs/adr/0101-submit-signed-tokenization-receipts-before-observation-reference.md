# Submit Signed Tokenization Receipts Before Observation Reference

The Tokenization Service has one registered asymmetric service identity and signs each Tokenization Result Receipt.
Each result receipt binds the exact Tokenization Grant Activation Snapshot and Tokenization Grant Application Receipt
under which the request was accepted. The service submits the exact signed result receipt, Grant Activation Snapshot,
and Grant Application Receipt bytes to private `POST /diagnostic/v0/tokenization-result-receipts` before any observation
may reference it. Diagnostic Plane verifies the Kernel signature on the snapshot, Tokenization Service signature and
bindings on the application receipt, registered service identity, result-receipt signature and digest, effective
applied grant, requester, field role, namespace, version, collection window, byte and rate limits, and result token,
then preserves the complete signed proof chain immutably. Exact replay returns the existing record; identity reuse with
changed bytes creates a conflict.

A Diagnostic Observation Envelope references the preserved Tokenization Result Receipt ID and digest. Observation
intake verifies the record exists and that service, requester, grant, field role, namespace, version, and token match
the signed claim before accepting it. Missing, mismatched, unapplied, expired, or revoked references fail closed. The
Independent Diagnostic Verification Bundle includes exact signed receipt bytes and the registered service
verification identity. Raw tokenization inputs and unsalted input digests are never transported or retained.

When a selected observation or equality edge cites a Tokenization Result Receipt, deterministic package selection
includes the signed result receipt, service verification identity, Grant Activation Snapshot, and Grant Application
Receipt as authenticated provenance dependencies. Collection leases and package pins cover the complete chain;
ordinary garbage collection cannot remove it while the package remains retained, and governed erasure produces
tombstones plus explicit material-availability degradation.
