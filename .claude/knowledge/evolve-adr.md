---
name: evolve-adr
description: Architecture decision records (ADRs) - short, immutable records of one significant decision with context, options, decision and consequences; Nygard's format, Azure's additions, and what to record or skip
domain: software-architecture
tags: evolve,adr,decisions,documentation,rationale
apply_when: "a significant technical decision is made or reversed and its reasons must survive team changes; onboarding people who ask 'why is it built this way'"
sources: "Nygard - Documenting Architecture Decisions, 15 Nov 2011, cognitect.com (read); Microsoft - Azure Well-Architected Framework, Maintain an architecture decision record (read); arc42 documentation, section 9 Architecture Decisions (read); adr.github.io (read, definitions)"
last_reviewed: 2026-09-21
confidence: high
---

# Architecture decision records

## Problem

Nygard: one of the hardest things to track over a project's life is the motivation behind
decisions. New members then either accept decisions blindly or change them blindly, and both
can hurt. Azure adds that a decision that is made but never recorded is likely to be forgotten,
which leads to repeated debates or changes that contradict the original intent.

## Definitions

- **Architectural decision**: a justified design choice for a functional or non-functional
  requirement with architectural significance (adr.github.io).
- **ADR**: a record of one such decision with its justification, trade-offs and consequences.
- **Decision log**: the collection of ADRs over the life of the project.

## Nygard's format

| Part | Content |
|---|---|
| Title | short noun phrase |
| Status | proposed, accepted, deprecated, or superseded |
| Context | the forces at play (technical, political, social, project-local), in value-neutral language |
| Decision | full sentences in active voice, "We will ..." |
| Consequences | the resulting context after applying the decision; all consequences, not just the positive ones |

Nygard's guidance: one or two pages, because large documents are never kept up to date;
number ADRs sequentially and never reuse numbers; keep them in the project repository (his
example path is `doc/arch/adr-NNN.md`); when a decision is reversed keep the old ADR and mark
it superseded; write as a conversation with a future developer.

## Azure's additions

- Record only choices that affect structure or key quality attributes, or are difficult to
  reverse.
- Treat the log as append-only: do not edit accepted records; write a new record that
  supersedes the old and link them.
- Include the options considered, the important trade-offs, and a confidence level, since a
  significant decision is sometimes made with low confidence and knowing that helps later
  reconsideration.
- Split a decision that plays out in phases (short, mid, long term) into one record per phase.
- Keep records short and factual; put extended design material in a linked document, but the
  decision must stand alone.
- Start the log at the beginning of a workload; for an existing system, reconstruct past
  decisions retroactively when data is available.

## arc42 view

arc42 section 9 records important, expensive, large-scale or risky decisions and their
rationale, and suggests three formats: individual ADRs (Nygard's five parts), a table ordered
by importance, or a section per decision. It advises leaving out what building-block
documentation already explains.

## Use when

- A choice is expensive to reverse, shapes many parts, or serves a top quality goal
  (`foundation-significant-requirements`): style, data store, integration approach,
  major framework.
- Someone will ask "why" in a year, or a decision was contested.
- Reversing a past decision: write the superseding record instead of editing history.

## Do not use when

- The decision is routine, local and cheap to change; a code comment or commit message
  suffices.
- As a design document or as a substitute for discussion; the record captures the outcome
  and reasons, not the whole ideation.
- The log is nobody's job and no one reads it; a stale log is worse than none because it
  misleads.

## Trade-offs

- Immutable records keep an honest history but can leave outdated ADRs that must be found via
  supersession links.
- Short records are read and maintained but omit detail; link detail rather than embed it.
- Writing ADRs slows decisions slightly and speeds all later reviews and onboarding.

## Common mistakes

- Recording only the positive consequences.
- Editing an accepted ADR to match what happened, destroying the reasoning at the time.
- Recording decisions without the alternatives that were rejected.
- One huge ADR covering many decisions, so nothing can be superseded cleanly.
- Keeping ADRs in a wiki away from the code so they drift from it.

## Related

- Notes: `foundation-what-is-architecture`, `foundation-significant-requirements`,
  `quality-tradeoff-analysis`, `evolve-documentation-arc42`, `style-choosing`, `evolve-technical-debt`
