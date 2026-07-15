---
status: accepted
---

# Observe external workflows through runtime adapters

External automation systems integrate through versioned Workflow Runtime Adapters that describe workflows and revisions, receive or retrieve execution observations, request supported replay, and report runtime health. Push-summary and pull-detail is preferred to unnecessary payload collection, direct runtime database access is prohibited, and n8n V0.2 generalizes the signed asynchronous Butler webhook and callback lessons into this provider-neutral contract.
