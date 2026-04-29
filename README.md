# Provenance Gate

**Stop AI agents from passing quality gates with unverifiable claims.**

> If an AI agent says "review passed", this gate asks:
> "Where is the review?"

Provenance Gate is a small, dependency-free example of an evidence-based quality
gate for AI-agent workflows. It rejects `verdict: GO`, `score: 99`, or
`review passed` unless the required review, scoring, and trace artifacts
actually exist.

## The Problem

AI agents are increasingly used to implement, review, score, document, and ship
work. But many internal automation flows still trust scalar claims:

- `review: passed`
- `score: 99`
- `tests: passed`
- `approved: true`

Those claims are easy for an agent to produce, even when the underlying review
or scoring step did not actually run.

## The Idea

Do not trust the claim. Check the provenance.

A gate should verify:

- who reviewed it,
- what rubric was used,
- which review passes ran,
- where the score files are,
- whether the score improved over time,
- whether cost and runtime logs show that evaluation actually happened.

## Quick Start

```bash
git clone https://github.com/provenance-gate/provenance-gate --depth 1
cd provenance-gate
npm install
npm test

node src/cli.js examples/missing-provenance.json      # NOT_READY
node src/cli.js examples/self-attested-review.json    # NOGO
node src/cli.js examples/valid-provenance.json        # GO
```

## Example Outcomes

| Case | Result | Why |
|---|---:|---|
| Missing review artifacts | `NOT_READY` | The gate cannot confirm that review ran. |
| Self-attested review | `NOGO` | The implementer is also claiming to be the reviewer. |
| Independent artifacts present | `GO` | Required evidence exists and passes the policy. |

## What It Checks

- Review run directory exists
- Rubric exists
- Review pass files exist
- Score files exist
- Score progression is present
- Cost log exists
- Reviewer is not self-attested
- Score threshold is met
- Creative contract is not placeholder or mood-only
- Creative fidelity threshold is at least 90

## What This Repository Contains

- A dependency-free Node.js gate implementation
- Example inputs for `NOT_READY`, `NOGO`, and `GO`
- Minimal review/scoring artifacts used by the valid example
- A public case-study draft under `article/`
- Sanitization notes in `SANITIZATION.md`

This repository intentionally does **not** include private raw evidence,
customer data, local machine paths, internal project logs, or private
development history.

## What This Is Not

This is not a complete security product.

It does not yet provide:

- signed artifacts,
- append-only storage,
- remote attestation,
- CI-native enforcement,
- tamper-proof logs,
- hosted dashboards.

It is a minimal worked example of the pattern.

## Who This Is For

- AI-agent framework builders
- Internal automation teams
- Eval and QA engineers
- Developer tooling teams
- People building autonomous coding or review workflows

## Why Now

As agents move from autocomplete to autonomous execution, quality gates need to
verify execution evidence, not just natural-language claims.

Scalar quality claims are not enough.

## Roadmap

- GitHub Actions integration
- JSON Schema policy files
- Signed provenance bundles
- CI annotations
- Hosted report viewer
- Multi-agent reviewer identity model

## Related Article

This repository accompanies a Japanese case study on an AI-agent review gate
bypass and the migration from scalar self-attestation to provenance-based
verification.

Article URL: TBD
