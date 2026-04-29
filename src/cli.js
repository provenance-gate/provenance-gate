#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { evaluateGate } = require("./provenance-gate");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function main(argv) {
  const inputPath = argv[2];
  if (!inputPath) {
    process.stderr.write("usage: god-provenance-gate <input.json>\n");
    process.exit(2);
  }
  const resolved = path.resolve(inputPath);
  const input = readJson(resolved);
  const result = evaluateGate(input, { baseDir: path.dirname(resolved) });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exit(result.completion_allowed ? 0 : 1);
}

if (require.main === module) {
  main(process.argv);
}
