# Govern Tokenization With Separate Use Grants

The customer-side Tokenization Service is a separate v1 deployable and Principal holding domain-separated
tokenization keys. Observation Reporting Grants do not authorize tokenization. Kernel issues Tokenization Use Grants
binding requester Principal, installation, environment, integration, exact field role, namespace and version, byte
limits, collection window, rate, and service binding.

Kernel publishes desired Tokenization Grant Activation Snapshots through a dedicated one-way authority feed. The
Tokenization Service applies each snapshot durably, signs a Tokenization Grant Application Receipt, and returns it
for Kernel verification. Activation and revocation become effective only at the service application transaction.

Observers receive narrowly scoped API authority and never tokenization secrets. The service emits immutable
Tokenization Result Receipts binding grant and result provenance without retaining raw inputs or unsalted digests of
low-entropy values. The service signs each receipt with its registered asymmetric identity and submits the exact
bytes to Diagnostic Plane before an observation may cite it. Diagnostic Plane verifies and preserves the receipt;
observation intake validates every reference against the preserved material. Requests outside field, namespace,
version, timing, size, or rate scope fail closed and remain bounded audit records.
