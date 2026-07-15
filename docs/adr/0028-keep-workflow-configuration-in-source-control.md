---
status: accepted
---

# Keep workflow configuration in source control

Workflow identity, revision inputs, diagnostic policy, verification fixtures, environment mappings, and optional Behavior Contracts live in a repository-owned Workflow Manifest and related versioned files. Builder Console edits become proposed commits or pull requests, Alphonse imports immutable revisions, and secrets, diagnostic observations, Kernel authority, and operational state remain outside source control.
