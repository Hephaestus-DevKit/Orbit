---
description: Inspect, implement and review a change with durable stage gates
argument-hint: <requested change>
stages:
  - id: inspect
    title: Inspect and scope
    prompt: Inspect the relevant code and project instructions. Write scope, risks, and acceptance checks to workflow-analysis.md. Do not implement yet. Ask before overwriting unrelated existing reports.
    artifacts: [workflow-analysis.md]
  - id: implement
    title: Implement and verify
    prompt: Implement only the requested change, preserve unrelated edits, add regression coverage and run the project verification contract. Treat workflow-analysis.md as immutable evidence.
    verification: true
  - id: review
    title: Review and hand off
    prompt: Review the final diff against workflow-analysis.md. Fix in-scope defects, rerun verification and write the exact results and remaining limitations to workflow-review.md. Do not commit, publish or install globally without explicit authorization.
    verification: true
    artifacts: [workflow-review.md]
---

Complete the requested change: $ARGUMENTS.
Follow repository instructions and normal permission boundaries. Stop and ask
when the requested scope or a destructive action needs user authorization.
