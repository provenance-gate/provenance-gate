"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SCHEMA_VERSION = "provenance_gate.audit_evidence_manifest.v1";
const COMPATIBLE_SCHEMA_VERSIONS = new Set([
  SCHEMA_VERSION,
  "god.audit_evidence_manifest.v1"
]);
const SKIP_STATUSES = new Set([
  "not_created",
  "skipped",
  "skipped_or_unavailable",
  "unavailable",
  "not_applicable"
]);

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
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
  if (!fs.existsSync(resolved.path)) return { ok: false, reason: "dir_missing", path: resolved.path };
  const stat = fs.statSync(resolved.path);
  if (!stat.isDirectory()) return { ok: false, reason: "not_a_directory", path: resolved.path };
  return { ok: true, path: resolved.path };
}

function manifestRef(input) {
  if (!input || typeof input !== "object") return null;
  const raw = input.audit_evidence_manifest || input.audit_manifest || input.audit_log_manifest;
  if (!raw) return null;
  if (typeof raw === "string") return { path: raw };
  if (typeof raw !== "object") return null;
  return {
    path: raw.path || raw.manifest_path || raw.artifact_path || raw.output_file_path,
    sha256: raw.sha256 || raw.manifest_sha256 || raw.output_sha256
  };
}

function requireArray(manifest, key, reasons) {
  if (!Array.isArray(manifest[key])) {
    reasons.push(`audit_evidence_manifest_${key}_not_array`);
    return [];
  }
  return manifest[key];
}

function validateSha256(baseDir, filePath, declaredSha, key, index, reasons) {
  if (!hasText(declaredSha)) {
    reasons.push(`audit_evidence_manifest_${key}_${index}_sha256_missing`);
    return;
  }
  const declared = String(declaredSha).trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(declared)) {
    reasons.push(`audit_evidence_manifest_${key}_${index}_sha256_invalid`);
    return;
  }
  const resolved = resolveInside(baseDir, filePath);
  if (!resolved.ok) {
    reasons.push(`audit_evidence_manifest_${key}_${index}_${resolved.reason}`);
    return;
  }
  if (sha256(resolved.path) !== declared) {
    reasons.push(`audit_evidence_manifest_${key}_${index}_sha256_mismatch`);
  }
}

function validateFileEntry(baseDir, entry, key, index, reasons) {
  if (!entry || typeof entry !== "object") {
    reasons.push(`audit_evidence_manifest_${key}_${index}_not_object`);
    return;
  }
  const status = String(entry.status || "created").trim();
  if (SKIP_STATUSES.has(status)) {
    if (!hasText(entry.reason)) reasons.push(`audit_evidence_manifest_${key}_${index}_skip_reason_missing`);
    return;
  }
  const filePath = entry.path || entry.artifact_path || entry.output_file_path;
  if (!hasText(filePath)) {
    reasons.push(`audit_evidence_manifest_${key}_${index}_path_missing`);
    return;
  }
  const check = fileExists(baseDir, filePath);
  if (!check.ok) {
    reasons.push(`audit_evidence_manifest_${key}_${index}_${check.reason}`);
    return;
  }
  validateSha256(baseDir, filePath, entry.sha256 || entry.output_sha256 || entry.artifact_sha256, key, index, reasons);
}

function validateRunDirEntry(baseDir, entry, index, reasons) {
  if (!entry || typeof entry !== "object") {
    reasons.push(`audit_evidence_manifest_run_dirs_${index}_not_object`);
    return;
  }
  const status = String(entry.status || "created").trim();
  if (SKIP_STATUSES.has(status)) {
    if (!hasText(entry.reason)) reasons.push(`audit_evidence_manifest_run_dirs_${index}_skip_reason_missing`);
    return;
  }
  if (!hasText(entry.path)) {
    reasons.push(`audit_evidence_manifest_run_dirs_${index}_path_missing`);
    return;
  }
  const check = dirExists(baseDir, entry.path);
  if (!check.ok) reasons.push(`audit_evidence_manifest_run_dirs_${index}_${check.reason}`);
}

function validateIndependentAuditEntry(baseDir, entry, index, reasons) {
  validateFileEntry(baseDir, entry, "independent_audit_evidence", index, reasons);
  if (!entry || typeof entry !== "object") return;
  const requiredText = ["agent_id", "nickname", "reviewer_role", "audit_prompt", "verdict"];
  for (const field of requiredText) {
    if (!hasText(entry[field])) reasons.push(`audit_evidence_manifest_independent_audit_evidence_${index}_${field}_missing`);
  }
  const verdict = String(entry.verdict || "").trim().toUpperCase();
  if (verdict && !["GO", "NOGO", "ESCALATE"].includes(verdict)) {
    reasons.push(`audit_evidence_manifest_independent_audit_evidence_${index}_verdict_invalid`);
  } else if (verdict && verdict !== "GO") {
    reasons.push(`audit_evidence_manifest_independent_audit_evidence_${index}_verdict_not_go`);
  }
  if (!Array.isArray(entry.files_read) || entry.files_read.length === 0) {
    reasons.push(`audit_evidence_manifest_independent_audit_evidence_${index}_files_read_missing`);
  }
  if (!entry.findings || typeof entry.findings !== "object") {
    reasons.push(`audit_evidence_manifest_independent_audit_evidence_${index}_findings_missing`);
  } else {
    for (const severity of ["P0", "P1", "P2"]) {
      if (!Array.isArray(entry.findings[severity])) {
        reasons.push(`audit_evidence_manifest_independent_audit_evidence_${index}_findings_${severity}_missing`);
      }
    }
  }
}

function strictAuditClaim(input) {
  if (!input || typeof input !== "object") return false;
  if (input.mode === "strict" || input.strict_audit === true || input.full_audit === true) return true;
  const text = [
    input.report_text,
    input.summary,
    input.completion_summary,
    input.review && input.review.summary,
    input.score && input.score.summary
  ]
    .filter((v) => v !== undefined && v !== null)
    .map((v) => typeof v === "string" ? v : JSON.stringify(v))
    .join("\n");
  return /\bGOD\s+audited\b|\bGOD\s+audit(?:ed)?\b|\blysis\s+GO\b|\bKPI\s+95\+?\b|\b95\+\s+PASS\b|GOD\u76e3\u67fb|lysis\s*GO|KPI\s*95|95\u70b9/i.test(text);
}

function verifyAuditEvidenceManifest(input, options = {}) {
  const baseDir = options.baseDir || process.cwd();
  const policy = options.policy || {};
  const reasons = { missing: [], failed: [], warnings: [] };
  const ref = manifestRef(input);

  if (!ref || !hasText(ref.path)) {
    reasons.missing.push("audit_evidence_manifest_missing");
    return { ok: false, reasons };
  }

  const manifestFile = fileExists(baseDir, ref.path);
  if (!manifestFile.ok) {
    reasons.failed.push(`audit_evidence_manifest_${manifestFile.reason}`);
    return { ok: false, reasons, path: ref.path };
  }

  if (!hasText(ref.sha256)) {
    reasons.missing.push("audit_evidence_manifest_sha256_missing");
  } else {
    const declared = String(ref.sha256).trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(declared)) reasons.failed.push("audit_evidence_manifest_sha256_invalid");
    else if (sha256(manifestFile.path) !== declared) reasons.failed.push("audit_evidence_manifest_sha256_mismatch");
  }

  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestFile.path, "utf8"));
  } catch (error) {
    reasons.failed.push("audit_evidence_manifest_json_invalid");
    return { ok: false, reasons, path: manifestFile.path };
  }

  if (!manifest || typeof manifest !== "object") {
    reasons.failed.push("audit_evidence_manifest_not_object");
    return { ok: false, reasons, path: manifestFile.path };
  }
  if (!COMPATIBLE_SCHEMA_VERSIONS.has(manifest.schema_version)) {
    reasons.failed.push("audit_evidence_manifest_schema_version_invalid");
  }

  const requiredFields = policy.auditEvidenceManifestFields || [
    "mode",
    "execution_profile",
    "gate_statuses",
    "run_dirs",
    "evidence_files",
    "independent_audit_evidence",
    "skipped_or_unavailable",
    "sha256"
  ];
  for (const field of requiredFields) {
    if (!hasValue(manifest[field])) reasons.missing.push(`audit_evidence_manifest_field_missing:${field}`);
  }

  requireArray(manifest, "run_dirs", reasons.missing)
    .forEach((entry, index) => validateRunDirEntry(baseDir, entry, index, reasons.failed));
  requireArray(manifest, "evidence_files", reasons.missing)
    .forEach((entry, index) => validateFileEntry(baseDir, entry, "evidence_files", index, reasons.failed));
  const independent = requireArray(manifest, "independent_audit_evidence", reasons.missing);
  independent.forEach((entry, index) => validateIndependentAuditEntry(baseDir, entry, index, reasons.failed));
  requireArray(manifest, "skipped_or_unavailable", reasons.missing)
    .forEach((entry, index) => {
      if (!entry || typeof entry !== "object") reasons.failed.push(`audit_evidence_manifest_skipped_or_unavailable_${index}_not_object`);
      else if (!hasText(entry.reason)) reasons.missing.push(`audit_evidence_manifest_skipped_or_unavailable_${index}_reason_missing`);
    });

  if ((policy.requireIndependentAuditEvidence !== false || strictAuditClaim(input)) && independent.length === 0) {
    reasons.failed.push("audit_evidence_manifest_independent_audit_evidence_missing");
  }

  const ok = reasons.missing.length === 0 && reasons.failed.length === 0;
  return {
    ok,
    reasons,
    path: manifestFile.path,
    sha256: hasText(ref.sha256) ? String(ref.sha256).trim().toLowerCase() : null,
    manifest
  };
}

function writeAuditEvidenceManifest(filePath, manifest) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const body = JSON.stringify(Object.assign({ schema_version: SCHEMA_VERSION }, manifest), null, 2) + "\n";
  fs.writeFileSync(filePath, body, "utf8");
  return { path: filePath, sha256: sha256(filePath) };
}

module.exports = {
  SCHEMA_VERSION,
  sha256,
  verifyAuditEvidenceManifest,
  writeAuditEvidenceManifest
};
