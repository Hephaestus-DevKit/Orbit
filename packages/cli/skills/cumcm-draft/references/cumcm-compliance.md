# CUMCM compliance profile

Checked against the official CUMCM site on 2026-09-01. Recheck the official
site at the start of every contest cycle; newer organizer material and supplied
regional requirements outrank this reference.

## 2026 paper and support-material rules

- Use white A4 paper with every margin at least 2.5 cm.
- The electronic paper starts with the title, Chinese abstract, and keywords on
  a single abstract page numbered 1. Do not include the commitment or numbering
  pages in the electronic paper.
- Start the body on page 2 of the electronic PDF, include no table of contents,
  and keep the body within 30 pages. Appendix pages are unlimited.
- Submit one uncompressed PDF or Word paper file no larger than 20 MB.
- Submit a separate ZIP/RAR support archive no larger than 20 MB.
- Put an exact support-archive file list in the paper appendix. Grouping by
  directory is acceptable for readability, but every filename must remain
  identifiable and the list must match the final archive.
- Include every complete runnable source program and necessary supporting data,
  results, and large intermediate figures. Do not include organizer-supplied raw
  problem files merely to duplicate them.
- Keep commitment/numbering pages and all team, school, region, instructor, and
  other identifying information out of the paper and support archive.
- Cite every external or public source near its use and list it in the
  references.

Official format source:
<https://www.mcm.edu.cn/html_cn/node/4cd596519c9eb9fbd866398f6df0caa3.html>

## Current AI-use rule

The organizer published the Chinese “2026 trial” AI-use rule on 2026-08-03,
effective from 2026-09-01. It supersedes inconsistent earlier rules:

1. Treat large language models, generative AI, code assistants, and AI agents
   as AI tools.
2. Keep core modeling and analysis team-led. Manually review and verify every
   AI-assisted contribution; the team remains responsible for originality,
   truthfulness, and accuracy.
3. Put an `AI工具使用声明` immediately before the references and use exactly one
   official branch:
   - unused: `本参赛队在竞赛过程中未使用任何AI工具。`
   - used: `本参赛队在竞赛过程中使用了AI工具，主要用于〖简要用途，如语言润色、代码调试等〗，详细使用情况见支撑材料。`
4. For used AI, put `AI工具使用详情.pdf` in the support archive. Record tool
   name and version/model, purpose and stage, major prompting approach and
   usage process, and principal adoption, manual modification, and verification.
   Typical interaction examples are optional.
5. The 2026 rule does not require inline body markers or an AI-tool bibliography
   entry. Do not mislabel those older requirements as current official gates.
6. Concealment, a false declaration, or directly submitting unreviewed AI core
   modeling/analysis can cancel award eligibility.

Official 2026 AI-use rule:
<https://www.mcm.edu.cn/html_cn/node/fef94648f2836ab6cc81586f4c38512b.html>

The 2026 participation rule permits AI as an auxiliary tool and requires
compliance with the current AI-use rule:
<https://www.mcm.edu.cn/html_cn/node/9d8e511fe7a1447b35f53a82c908e2e0.html>

## Guardrails

- Keep `ai.submission_intent` as `training` for end-to-end AI-led rehearsal
  work. Change it to `formal` only when the team actually led the core model and
  analysis and completed item-by-item manual review; record both facts in the
  active contest profile.
- A training artifact substantially modeled or written by AI cannot truthfully
  be relabeled as team-independent core work. Preserve the disclosure and require
  an independent redo before formal submission.
- A generic AI declaration paragraph is not an official substitute for body
  marks, reference entries, or `AI工具使用详情.pdf`.
- No official source above establishes an AIGC/AIDC percentage threshold. Do not
  encode secondary “20%” claims as a disqualification rule.
