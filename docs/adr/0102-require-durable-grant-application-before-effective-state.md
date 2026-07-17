# Require Durable Grant Application Before Effective State

Kernel publication alone does not make an Observation Reporting Grant or Tokenization Use Grant effective. Kernel
publishes a signed desired-state snapshot through the service-specific one-way authority feed. Diagnostic Plane or
Tokenization Service applies the exact snapshot durably and returns a signed application receipt binding snapshot,
authority sequence and predecessor, target state, local transaction identity, service identity, and first-party
application time. The service submits the exact receipt bytes to private
`POST /authority/v0/grant-application-receipts`; Kernel verifies the registered service identity, signature, and every
binding before preserving the receipt and recording effective state.

Activation becomes effective at the service application transaction; Kernel records `active_effective` only after
verifying the receipt. Revocation remains `revocation_pending` until service application, becomes ineffective at that
transaction, and Kernel then records `revoked_effective`. Reports or tokenization completed before effective
revocation remain historically valid under the prior state. Deployment sealing and stimulus require application
receipts for every active grant snapshot. Stale, missing, or mismatched application state fails closed.
