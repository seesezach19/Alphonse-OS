# 16 - Coordinate Support Without Standing Authority

**What to build:** Hosted/local coordination exposes sanitized health and lets a customer grant temporary support access, inspect diagnostics, quarantine a host, and revoke coordination without granting standing business authority.

**Blocked by:** 13 - Promote Across Customer Environments; 15 - Restore Without Duplicating External Work.

**Status:** ready-for-agent

- [ ] Environment publishes signed coarse health with freshness and no business payloads.
- [ ] Missing heartbeat displays unknown rather than inventing failure.
- [ ] Support case requests exact Environment, diagnostic scope, identity, duration, and expiry.
- [ ] Customer Kernel issues temporary read-only Support Passport by default.
- [ ] Any remediation requires exact locally approved Capability and is ledgered.
- [ ] Redacted diagnostic bundle is explicit, immutable, encrypted, access-logged, and expiring.
- [ ] Host quarantine blocks new placement, fences workloads under policy, and rotates/revokes host key.
- [ ] Coordinator Binding revocation removes hosted visibility/support while local authority and history continue.
