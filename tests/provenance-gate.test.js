"use strict";

const assert = require("assert");
const path = require("path");
const {
  evaluateReviewProvenance,
  evaluateCreativeContract,
  evaluateGate
} = require("../src/provenance-gate");

const examples = path.resolve(__dirname, "..", "examples");

function run() {
  const missing = require("../examples/missing-provenance.json");
  const missingResult = evaluateGate(missing, { baseDir: examples });
  assert.strictEqual(missingResult.status, "NOT_READY");
  assert.strictEqual(missingResult.completion_allowed, false);
  assert.ok(missingResult.reasons.missing.includes("review_run_dir_missing"));
  assert.ok(missingResult.reasons.missing.includes("rubric_path_missing"));

  const self = require("../examples/self-attested-review.json");
  const selfResult = evaluateReviewProvenance(self, { baseDir: examples });
  assert.strictEqual(selfResult.status, "NOGO");
  assert.ok(selfResult.reasons.failed.includes("reviewer_self_not_independent"));

  const valid = require("../examples/valid-provenance.json");
  const validResult = evaluateGate(valid, { baseDir: examples });
  assert.strictEqual(validResult.status, "GO");
  assert.strictEqual(validResult.completion_allowed, true);

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
