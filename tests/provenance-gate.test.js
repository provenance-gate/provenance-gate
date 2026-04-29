"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  evaluateReviewProvenance,
  evaluateCreativeContract,
  evaluateGate
} = require("../src/provenance-gate");
const { sha256, writeAuditEvidenceManifest } = require("../src/audit-manifest");

const examples = path.resolve(__dirname, "..", "examples");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "provenance-gate-"));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeFixtureFile(filePath, body) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body, "utf8");
  return sha256(filePath);
}

function writeFixtureManifest(baseDir, options = {}) {
  const runDir = path.join(baseDir, "run");
  fs.mkdirSync(runDir, { recursive: true });
  const rubric = writeFixtureFile(path.join(runDir, "rubric.yaml"), "criteria:\n  - evidence\n");
  const pass = writeFixtureFile(path.join(runDir, "pass_001.md"), "verdict: GO\n");
  const score = writeFixtureFile(path.join(runDir, "score_v1.yaml"), "score: 98\n");
  const cost = writeFixtureFile(path.join(runDir, "cost_log.jsonl"), "{\"tool\":\"fixture\"}\n");
  const independent = writeFixtureFile(path.join(runDir, "independent-review.md"), "verdict: GO\nreviewer: Carver\n");
  const independentEntries = options.independent === false ? [] : [
    {
      kind: "final_gate_independent_review",
      path: "run/independent-review.md",
      sha256: independent,
      status: "created",
      agent_id: "agent_fixture",
      nickname: "Carver",
      reviewer_role: "independent_reviewer",
      audit_prompt: "Review this fixture independently.",
      files_read: ["src/provenance-gate.js"],
      verdict: "GO",
      findings: { P0: [], P1: [], P2: [] }
    }
  ];
  const ref = writeAuditEvidenceManifest(path.join(baseDir, "manifest.json"), {
    mode: "strict",
    execution_profile: { profile: "strict" },
    gate_statuses: [{ gate: "final_gate", status: "GO" }],
    run_dirs: [{ kind: "review_run", path: "run", status: "created" }],
    evidence_files: [
      { kind: "rubric", path: "run/rubric.yaml", sha256: rubric, status: "created" },
      { kind: "review_pass", path: "run/pass_001.md", sha256: pass, status: "created" },
      { kind: "score", path: "run/score_v1.yaml", sha256: score, status: "created" },
      { kind: "cost_log", path: "run/cost_log.jsonl", sha256: cost, status: "created" }
    ],
    independent_audit_evidence: independentEntries,
    skipped_or_unavailable: [
      { kind: "external_immutable_seal", status: "not_applicable", reason: "fixture is local hash verified only" }
    ],
    sha256: { note: "per-file hashes are recorded in manifest entries" }
  });
  return {
    input: {
      mode: "strict",
      implementer_identity: "claude-code",
      audit_evidence_manifest: {
        path: path.relative(baseDir, ref.path),
        sha256: ref.sha256
      },
      review: {
        run_dir: "run",
        verdict: "GO",
        reviewer_identity: "codex-cli",
        rubric_path: "run/rubric.yaml",
        pass_files: ["run/pass_001.md"]
      },
      score: {
        score: 98,
        verdict: "PASS",
        rater: "codex-cli",
        score_files: ["run/score_v1.yaml"],
        score_progression: ["run/score_v1.yaml"],
        cost_log_path: "run/cost_log.jsonl"
      }
    }
  };
}

function run() {
  const missing = require("../examples/missing-provenance.json");
  const missingResult = evaluateGate(missing, { baseDir: examples });
  assert.strictEqual(missingResult.status, "NOT_READY");
  assert.strictEqual(missingResult.completion_allowed, false);
  assert.ok(missingResult.reasons.missing.includes("review_run_dir_missing"));
  assert.ok(missingResult.reasons.missing.includes("rubric_path_missing"));
  assert.ok(missingResult.reasons.missing.includes("audit_evidence_manifest_missing"));

  const self = require("../examples/self-attested-review.json");
  const selfResult = evaluateReviewProvenance(self, { baseDir: examples });
  assert.strictEqual(selfResult.status, "NOGO");
  assert.ok(selfResult.reasons.failed.includes("reviewer_self_not_independent"));

  const valid = require("../examples/valid-provenance.json");
  const validResult = evaluateGate(valid, { baseDir: examples });
  assert.strictEqual(validResult.status, "GO");
  assert.strictEqual(validResult.completion_allowed, true);
  assert.strictEqual(validResult.review.audit_evidence_manifest.ok, true);

  const badManifestHash = clone(valid);
  badManifestHash.audit_evidence_manifest.sha256 = "0".repeat(64);
  const badManifestHashResult = evaluateGate(badManifestHash, { baseDir: examples });
  assert.strictEqual(badManifestHashResult.status, "NOGO");
  assert.ok(badManifestHashResult.reasons.failed.includes("audit_evidence_manifest_sha256_mismatch"));

  withTempDir((dir) => {
    const fixture = writeFixtureManifest(dir, { independent: false });
    const result = evaluateGate(fixture.input, { baseDir: dir });
    assert.strictEqual(result.status, "NOGO");
    assert.ok(result.reasons.failed.includes("audit_evidence_manifest_independent_audit_evidence_missing"));
  });

  const moodOnly = {
    creative_contract: {
      artifact_type: "game",
      reference_artifact: "mood only concept art",
      acceptance_criteria: ["Playable first screen"],
      fidelity_criteria: [{ name: "contract match", weight: 100 }],
      minimum_score: 90,
      implementation_feasibility: "Can be built",
      out_of_scope: ["multiplayer"]
    }
  };
  const moodResult = evaluateCreativeContract(moodOnly);
  assert.strictEqual(moodResult.status, "NOGO");
  assert.ok(moodResult.reasons.failed.includes("mood_only_reference_forbidden"));

  const placeholder = {
    creative_contract: {
      artifact_type: "document",
      reference_artifact: "<project>",
      acceptance_criteria: ["Complete article"],
      fidelity_criteria: [{ name: "quality", weight: 100 }],
      minimum_score: 90,
      implementation_feasibility: "State why this can be built.",
      out_of_scope: ["List assumptions"]
    }
  };
  const placeholderResult = evaluateCreativeContract(placeholder);
  assert.strictEqual(placeholderResult.status, "NOT_READY");
  assert.ok(placeholderResult.reasons.missing.includes("contract_contains_placeholder"));
}

run();
process.stdout.write("PASS tests/provenance-gate.test.js\n");
