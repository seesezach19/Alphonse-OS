---
status: accepted
---

# Use one local Owner in V0.2

V0.2 binds Console and APIs to loopback by default, bootstraps one Owner Principal through a one-time token, issues short-lived Passport-bound machine tokens, and gives each Runtime Adapter a separate generated credential. Promotion requires an active Owner session; public registration, email, teams, SSO, and general RBAC wait, while remote exposure requires explicit operator configuration.
