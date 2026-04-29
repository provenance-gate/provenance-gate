# Provenance Gate

This is a small, sanitized example of a provenance gate for AI-agent review and
scoring workflows.

The core idea is simple:

> A quality gate should verify evidence that review and scoring actually ran,
> not merely consume claims such as `verdict: GO` or `score: 99`.

## What This Repository Contains

- A dependency-free Node.js gate implementation.
- Example inputs that show three cases:
  - missing provenance -> `NOT_READY`
  - self-attested review -> `NOGO`
  - independent provenance files -> `GO`
- A public article draft under `article/`.

This repository intentionally does **not** include private raw evidence,
customer data, local machine paths, internal project logs, or the private
development history of the original harness.

## Quick Start

```bash
npm test
node src/cli.js examples/missing-provenance.json
node src/cli.js examples/self-attested-review.json
node src/cli.js examples/valid-provenance.json
```

The first two commands are expected to fail the gate. The third should return
`GO`.

## Gate Model

The example gate checks for:

- a review run directory,
- review pass files,
- a scoring rubric,
- score files and score progression,
- a cost log,
- an independent reviewer identity,
- score threshold,
- optional creative contract constraints.

It rejects:

- `reviewer: self`,
- missing `run_dir`,
- missing rubric/pass/score/cost artifacts,
- mood-only creative references,
- placeholder contracts,
- infeasible targets,
- creative fidelity thresholds below 90.

## Scope

This is not a full security product. It is a worked example for preventing a
common AI-agent quality-gate failure mode: scalar self-attestation passing as
verification.

For high-stakes environments, combine this pattern with CI logs, append-only
storage, signed artifacts, and external anchoring.
