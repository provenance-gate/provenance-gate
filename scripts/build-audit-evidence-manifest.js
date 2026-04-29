#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { writeAuditEvidenceManifest } = require("../src/audit-manifest");

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2).replace(/-/g, "_");
    const next = argv[i + 1];
    args[key] = next && !next.startsWith("--") ? argv[++i] : true;
  }
  return args;
}

function readStdinJson() {
  const text = fs.readFileSync(0, "utf8").trim();
  return text ? JSON.parse(text) : {};
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.out) throw new Error("--out is required");
  const manifest = readStdinJson();
  const ref = writeAuditEvidenceManifest(path.resolve(args.out), manifest);
  process.stdout.write(JSON.stringify({ audit_evidence_manifest: ref }, null, 2) + "\n");
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`build-audit-evidence-manifest error: ${error.message}\n`);
    process.exit(1);
  }
}
