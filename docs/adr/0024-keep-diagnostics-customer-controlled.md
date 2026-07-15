---
status: accepted
---

# Keep diagnostics customer-controlled

Raw diagnostic collection, storage, redaction, and Diagnostic Agent execution remain inside a customer-controlled boundary by default because traces may contain prompts, business data, code, tool arguments, and accidental secrets. Managed hosting must preserve equivalent isolation, while hosted coordination receives minimal metadata unless customers explicitly authorize redacted payload transfer; the added deployment friction is an accepted cost.
