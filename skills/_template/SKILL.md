---
name: alphacharts-<domain>
description: >
    One or two sentences: what an agent can do with this domain.
version: 1.0
api_version: 0.x
depends_on:
    - alphacharts-core
status: draft
---

# alphacharts <Domain>

## 1. When to use this skill

The requests that need this domain, and the ones that do not.

## 2. Domain overview

The concepts, in the order a model needs them.

## 3. API reference

Public names only: what the language and the studies expose. Generated references are linked, never retyped.

## 4. Standard workflow

The correct sequence of steps, numbered.

## 5. Examples

Executable scripts in ```alphacharts blocks. Every block is compiled with the real compiler and run on seeded bars by
`node scripts/check-skills.mjs`. An example of invalid usage says so on the line above its fence, naming the exact
diagnostic: `<!-- skill: invalid: <message> -->`. A numeric claim is pinned with
`<!-- skill: expect: {"Plot title": {"all": 2.5}} -->` (also `at`, `firstValid`). A script linked as a file (`.acs`) needs
a companion `<name>.expected.mjs` that recomputes its plots in plain JavaScript.

## 6. Composition

How this domain combines with the others.

## 7. Constraints and correctness

Limits, ordering, na behaviour, numeric conventions.

## 8. Common mistakes

Each mistake with the diagnostic it raises or the wrong result it gives.

## 9. Validation

The browser compiles the script and diagnostics come back; what else to verify.

## 10. Related skills

Links as relative paths: [Core](../core/SKILL.md).
