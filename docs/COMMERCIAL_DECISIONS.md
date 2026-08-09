# Commercial decisions requiring product-owner approval

Orbit's engineering gates cannot decide legal rights or business promises. The
items below must be approved by the product owner and reviewed by qualified
legal counsel before paid distribution. Orbit's source and supported CLI are
now licensed under Apache License 2.0; any separate commercial EULA or service
terms remain an owner decision.

| Decision             | Current technical state                                                                           | Required owner input                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Orbit license/EULA   | Apache License 2.0 applies to source and the supported CLI; no separate EULA is declared          | Confirm whether paid services need additional terms, governing law, or contractual warranties beyond the open-source grant |
| Distribution surface | Only `@orbit-build/cli` is treated as the supported product                                       | Confirm whether internal workspace packages remain unsupported implementation details                                      |
| Privacy terms        | Local-first; configured providers receive selected prompts/context; no default telemetry pipeline | Name the data controller, contact, regions, provider subprocessors, retention/deletion periods, and applicable user rights |
| Support policy       | Diagnostics and redacted support traces exist                                                     | Define supported OS/Node/provider versions, response targets, exclusions, and deprecation windows                          |
| Incident response    | Release provenance, audits, and rollback records exist                                            | Name security contacts, escalation owner, disclosure channel, and notification commitments                                 |
| Branding and claims  | Orbit and provider names appear in product copy                                                   | Approve trademarks, pricing/performance claims, and required provider disclaimers                                          |

## Approval record

Do not replace placeholders with assumptions. Record the approver, date,
reviewed document revision, and external counsel reference for every completed
decision. Keep the published license current, add privacy terms and a support
policy as dedicated top-level documents, and link all three from the npm README
before public sale.

| Decision | Approval                                  | Date       | Counsel reference |
| -------- | ----------------------------------------- | ---------- | ----------------- |
| License  | Repository owner, interactive instruction | 2026-08-09 | Not recorded      |
