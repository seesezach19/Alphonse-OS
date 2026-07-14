---
status: accepted
---

# Separate build sessions from published packages

Agents and Builders iterate inside disposable attributed Build Sessions that may be incomplete or invalid without affecting live behavior. Publication converts one validated result into an immutable Package Version for separate review and activation, preserving experimentation while keeping deployed behavior exact and reproducible.
