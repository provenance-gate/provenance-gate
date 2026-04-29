"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_POLICY = {
  minimumScore: 95,
  requireIndependentReviewer: true,
  requireRunDir: true,
  requireArtifacts: [
    "rubric_path",
    "pass_files",
    "score_files",
    "score_progression",
    "cost_log_path"
  ],
  creativeMinimumScore: 90
};

function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

function resolveInside(baseDir, candidate) {
  const base = path.resolve(baseDir || process.cwd());
  const resolved = path.resolve(base, String(candidate || ""));
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    return { ok: false, reason: "path_outside_base_dir", path: resolved };
  }
  return { ok: true, path: resolved };
}

function fileExists(baseDir, relativePath) {
  const resolved = resolveInside(baseDir, relativePath);
  if (!resolved.ok) return resolved;
  if (!fs.existsSync(resolved.path)) return { ok: false, reason: "file_missing", path: resolved.path };
  const stat = fs.statSync(resolved.path);
  if (!stat.isFile()) return { ok: false, reason: "not_a_file", path: resolved.path };
  if (stat.size === 0) return { ok: false, reason: "file_empty", path: resolved.path };
  return { ok: true, path: resolved.path, bytes: stat.size };
}

function dirExists(baseDir, relativePath) {
  const resolved = resolveInside(baseDir, relativePath);
  if (!resolved.ok) return resolved;
  if (!fs.existsSync(resolved.path)) return { ok: false, reason: "run_dir_missing", path: resolved.path };
  const stat = fs.statSync(resolved.path);
  if (!stat.isDirectory()) return { ok: false, reason: "run_dir_not_directory", path: resolved.path };
  return { ok: true, path: resolved.path };
}

function getScore(value) {
  if (typeof value === "number") return value;
  if (value && typeof value === "object") {
    if (typeof value.score === "number") return value.score;
    if (typeof value.total_awarded === "number") return value.total_awarded;
  }
  return null;
}

function evaluateReviewProvenance(input, options = {}) {
  const policy = Object.assign({}, DEFAULT_POLICY, options.policy || {});
  const baseDir = options.baseDir || process.cwd();
  const reasons = { missing: [], failed: [], warnings: [] };
  const evidence = [];
  const review = input.review || input.planning_review || input.implementation_review || {};
  const score = input.score || input.planning_score || input.implementation_score || {};

  if (policy.requireRunDir) {
    if (!hasValue(review.run_dir)) {
      reasons.missing.push("review_run_dir_missing");
    } else {
      const runDir = dirExists(baseDir, review.run_dir);
      if (!runDir.ok) reasons.failed.push(runDir.reason);
      else evidence.push(`review_run_dir:${review.run_dir}`);
    }
  }

  if (policy.requireIndependentReviewer) {
    const implementer = String(input.implementer_identity || input.author_identity || "").trim();
    const reviewer = String(review.reviewer_identity || review.reviewer || score.rater || "").trim();
    if (!reviewer) reasons.missing.push("reviewer_identity_missing");
    if (reviewer && /self/i.test(reviewer)) reasons.failed.push("reviewer_self_not_independent");
    if (implementer && reviewer && implementer === reviewer) reasons.failed.push("reviewer_same_as_implementer");
  }

  for (const field of policy.requireArtifacts) {
    const value = review[field] || score[field] || input[field];
    if (!hasValue(value)) {
      reasons.missing.push(`${field}_missing`);
      continue;
    }
    for (const item of asArray(value)) {
      const check = fileExists(baseDir, item);
      if (!check.ok) reasons.failed.push(`${field}_${check.reason}`);
      else evidence.push(`${field}:${item}`);
    }
  }

  const numericScore = getScore(score);
  if (numericScore === null) reasons.missing.push("score_missing");
  else if (numericScore < policy.minimumScore) reasons.failed.push("score_below_threshold");

  const verdict = String(review.verdict || score.verdict || "").toUpperCase();
  if (verdict && verdict !== "GO" && verdict !== "PASS") reasons.failed.push("verdict_not_pass");

  const status = reasons.failed.length > 0 ? "NOGO" : reasons.missing.length > 0 ? "NOT_READY" : "GO";
  return {
    status,
    completion_allowed: status === "GO",
    reasons,
    evidence,
    threshold: policy.minimumScore
  };
}

function evaluateCreativeContract(input, options = {}) {
  const policy = Object.assign({}, DEFAULT_POLICY, options.policy || {});
  const contract = input.creative_contract || input.contract || {};
  const reasons = { missing: [], failed: [], warnings: [] };
  const required = [
    "artifact_type",
    "reference_artifact",
    "acceptance_criteria",
    "fidelity_criteria",
    "minimum_score",
    "implementation_feasibility",
    "out_of_scope"
  ];

  for (const field of required) {
    if (!hasValue(contract[field])) reasons.missing.push(`${field}_missing`);
  }

  const text = JSON.stringify(contract);
  if (/\b(mood only|atmosphere only|vibe only|style reference only|loose reference)\b/i.test(text)) {
    reasons.failed.push("mood_only_reference_forbidden");
  }
  if (/\b(<[^>]+>|state why|list features|list assumptions|todo)\b/i.test(text)) {
    reasons.missing.push("contract_contains_placeholder");
  }
  if (contract.implementation_feasible === false || /\b(not feasible|cannot be built|unbuildable)\b/i.test(text)) {
    reasons.failed.push("target_not_feasible");
  }

  const minimumScore = Number(contract.minimum_score);
  if (!Number.isFinite(minimumScore)) reasons.missing.push("minimum_score_not_numeric");
  else if (minimumScore < policy.creativeMinimumScore) reasons.failed.push("creative_minimum_score_below_threshold");

  if (Array.isArray(contract.fidelity_criteria)) {
    let total = 0;
    for (const criterion of contract.fidelity_criteria) {
      const weight = Number(criterion && criterion.weight);
      if (!criterion || !hasValue(criterion.name || criterion.description)) {
        reasons.missing.push("fidelity_criterion_name_missing");
      }
      if (!Number.isFinite(weight) || weight <= 0) reasons.missing.push("fidelity_criterion_weight_missing");
      else total += weight;
    }
    if (total > 0 && Math.abs(total - 100) > 0.001) {
      reasons.failed.push("fidelity_weights_must_sum_to_100");
    }
  }

  const status = reasons.failed.length > 0 ? "NOGO" : reasons.missing.length > 0 ? "NOT_READY" : "GO";
  return {
    status,
    eligible: status === "GO",
    reasons,
    threshold: policy.creativeMinimumScore
  };
}

function evaluateGate(input, options = {}) {
  const reviewResult = evaluateReviewProvenance(input, options);
  const creativeRequired = input.creative_required === true || hasValue(input.creative_contract);
  const creativeResult = creativeRequired ? evaluateCreativeContract(input, options) : null;
  const reasons = {
    missing: reviewResult.reasons.missing.slice(),
    failed: reviewResult.reasons.failed.slice(),
    warnings: reviewResult.reasons.warnings.slice()
  };
  if (creativeResult) {
    reasons.missing.push(...creativeResult.reasons.missing.map((r) => `creative_${r}`));
    reasons.failed.push(...creativeResult.reasons.failed.map((r) => `creative_${r}`));
    reasons.warnings.push(...creativeResult.reasons.warnings.map((r) => `creative_${r}`));
  }
  const status = reasons.failed.length > 0 ? "NOGO" : reasons.missing.length > 0 ? "NOT_READY" : "GO";
  return {
    status,
    completion_allowed: status === "GO",
    review: reviewResult,
    creative: creativeResult,
    reasons
  };
}

module.exports = {
  DEFAULT_POLICY,
  evaluateReviewProvenance,
  evaluateCreativeContract,
  evaluateGate
};
