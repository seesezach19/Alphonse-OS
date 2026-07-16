# OpenClaw Diagnostic Workspace

This package attaches OpenClaw to one exact Alphonse diagnosis request as a customer-controlled Diagnostic Worker.

OpenClaw receives a short-lived Agent Passport token and a confirmed `diagnostic_analysis` Work Intent. It can retrieve the assigned redacted workspace, submit an immutable advisory proposal, or fail the request visibly. It cannot declare failure truth, mutate evidence, commission repair, verify, promote, change a target, or create external effects.

The workspace skill lives at `skill/SKILL.md`. Provisioning copies it to `<openclaw-workspace>/skills/alphonse-diagnostic`, OpenClaw's highest-precedence workspace skill location.
