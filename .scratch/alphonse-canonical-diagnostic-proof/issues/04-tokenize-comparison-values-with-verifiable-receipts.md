# 04 - Tokenize comparison values with verifiable result receipts

**What to build:** Allow separately authorized source and destination observers to obtain scoped equality tokens while
giving Diagnostic Plane and the independent verifier exact signed proof of every tokenization result used by an
observation.

**Blocked by:** 02 - Apply grant state durably before authority becomes effective.

**Status:** complete

- [x] Deploy the Tokenization Service as its own Principal with domain-separated secrets unavailable to observers,
      controllers, and Diagnostic Plane.
- [x] Activate and revoke narrowly scoped Tokenization Use Grants through the generic durable application protocol.
- [x] Bind each grant to requester, installation, environment, integration, field role, namespace, algorithm version,
      collection window, byte limit, rate limit, and service binding.
- [x] Tokenize exact length-delimited bytes without trimming, folding, Unicode normalization, coercion, raw-input
      retention, or unsalted low-entropy digests.
- [x] Sign each Tokenization Result Receipt with the registered asymmetric service identity and submit it to the
      private canonical receipt endpoint before observation reference.
- [x] Make Diagnostic Plane verify and preserve exact receipt bytes, with exact replay and changed-material conflict
      semantics.
- [x] Make observation intake fail closed when the referenced receipt is missing or any service, requester, grant,
      field, namespace, version, timing, or token binding differs.
- [x] Keep generic canonical observation intake usable without Tokenization Service deployment or references.
