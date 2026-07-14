# 03 - Retrieve Governed Inventory Context

**What to build:** The confirmed Builder Agent retrieves exact ERP and storefront inventory observations from a reference customer Data Plane under bounded authority/freshness policy, while Kernel stores only signed receipts and Butler exposes trustworthy context status.

**Blocked by:** 02 - Turn Confirmed Intent Into Accountable Work.

**Status:** ready-for-agent

- [ ] Reference Data Plane serves controlled ERP and storefront inventory observations with source authority and observation time.
- [ ] Kernel issues a bounded Context Access Grant tied to Passport, Work Intent, purpose, subjects, sensitivity, limits, and expiry.
- [ ] Effective access is the strict intersection of Kernel grant and Data Plane policy.
- [ ] Context payload travels directly to the runtime; Kernel persists no business payload.
- [ ] Kernel stores a signed Context Receipt with exact item references, hashes, authority, freshness, provenance, and recipient.
- [ ] Cache delivery preserves source observation time and discloses cache age.
- [ ] Stale, withdrawn, unauthorized, or over-broad requests reject deterministically.
- [ ] Butler thread shows context authority/freshness and redacts inaccessible fields.
