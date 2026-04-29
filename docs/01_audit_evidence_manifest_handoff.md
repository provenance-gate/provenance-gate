# Audit Evidence Manifest Handoff

## Summary

Provenance Gate now mirrors the GOD strict audit evidence contract in public
form. A `GO` result requires a real `audit_evidence_manifest` reference, a
matching manifest sha256, existing evidence files, matching evidence hashes, and
independent audit evidence in the manifest.

## What Changed

- Added `src/audit-manifest.js`.
- Added `scripts/build-audit-evidence-manifest.js`.
- Updated `src/provenance-gate.js` to validate audit evidence manifests.
- Updated the valid example to include an audit manifest and independent review
  fixture.
- Added regression coverage for missing manifests, manifest sha mismatch, and
  missing independent audit evidence.
- Updated README documentation.

## User-Facing Meaning

Before this change, a public fixture could prove that review files existed, but
it did not require a separate manifest listing the audit evidence. Now the gate
must be able to point to the audit evidence table before it says `GO`.

## Verification

Run:

```bash
npm test
node src/cli.js examples/valid-provenance.json
```

Expected result: both pass, and the valid CLI result exits with status `0`.

## Remaining Risk

This is still local hash verification. It proves that the files currently match
the manifest, but it does not make the evidence tamper-proof against someone who
can rewrite both the files and the manifest. Stronger versions can add signed
bundles, CI attestations, or append-only external storage.
